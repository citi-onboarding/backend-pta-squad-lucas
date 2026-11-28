import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";

import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { userData } from "../../tests/support/data-factories.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../tests/support/test-database.js";
import { createTestEnvironment } from "../../tests/support/test-environment.js";
import type { ErpSyncService } from "../modules/erp-sync/erp-sync.service.js";
import { hashPassword } from "../shared/security/password.js";
import { createApp } from "./create-app.js";

const captured = vi.hoisted(() => ({ logs: "" }));

// Keeps the real logger and the real application wiring; only the log sink,
// an external output, is redirected to memory.
vi.mock("../shared/logging/logger.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../shared/logging/logger.js")>();
  return {
    createLogger: (environment: Parameters<typeof original.createLogger>[0]) =>
      original.createLogger(
        environment,
        new Writable({
          write(chunk, _encoding, callback) {
            captured.logs += String(chunk);
            callback();
          },
        }),
      ),
  };
});

// Invented values that exist only inside the isolated test database and app.
const ADMIN_PASSWORD = "admin-test-password";
const NEW_PASSWORD = "distrilux-2026";
const NOW = new Date("2026-03-02T12:00:00.000Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const UNUSABLE_DETAIL = "Invitation link is invalid or expired.";
const INVITED_EMAIL = "invited.person@distrilux.com.br";

let testDatabase: TestDatabase;
let adminPasswordHash: string;
let app: ReturnType<typeof createApp>;
let adminId: string;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD);
  // The ERP service is an external boundary and is never called here.
  const erpSyncService = {
    startRun: vi.fn(),
    getStatus: vi.fn(),
    listRuns: vi.fn(),
    recoverInterruptedRuns: vi.fn(),
    waitForIdle: vi.fn(),
  } as unknown as ErpSyncService;
  // Only Date is faked: database and HTTP timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  app = createApp({
    database: testDatabase.database,
    environment: createTestEnvironment({
      DATABASE_URL: testDatabase.databaseUrl,
      LOG_LEVEL: "info",
    }),
    erpSyncService,
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await testDatabase?.stop();
});

beforeEach(async () => {
  vi.setSystemTime(NOW);
  captured.logs = "";
  const { database } = testDatabase;
  await database.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "customers" CASCADE',
  );
  const admin = await database.user.create({
    data: userData({
      name: "Lucas Moura",
      email: "lucas@distrilux.com.br",
      role: "ADMIN" as const,
      passwordHash: adminPasswordHash,
    }),
  });
  adminId = admin.id;
});

afterEach(() => {
  vi.setSystemTime(NOW);
});

// A session row inserted directly is always fresh at the controlled instant.
async function adminToken(): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await testDatabase.database.session.create({
    data: {
      userId: adminId,
      tokenDigest: createHash("sha256").update(token).digest("hex"),
      lastUsedAt: new Date(),
    },
  });
  return token;
}

function advance(milliseconds: number) {
  vi.setSystemTime(new Date(Date.now() + milliseconds));
}

async function registerInvited() {
  const response = await request(app)
    .post("/api/v1/users")
    .set("Authorization", `Bearer ${await adminToken()}`)
    .send({ name: "Invited Person", email: INVITED_EMAIL, role: "MANAGER" });
  expect(response.status).toBe(201);
  return {
    userId: response.body.user.id as string,
    token: response.body.invitation.token as string,
  };
}

async function issueNewInvitation(userId: string) {
  const response = await request(app)
    .post(`/api/v1/users/${userId}/invitations`)
    .set("Authorization", `Bearer ${await adminToken()}`);
  expect(response.status).toBe(201);
  return response.body.token as string;
}

function lookup(body: object) {
  return request(app).post("/api/v1/invitations/lookup").send(body);
}

function accept(body: object) {
  return request(app).post("/api/v1/invitations/accept").send(body);
}

function signInAs(password: string) {
  return request(app)
    .post("/api/v1/auth/login")
    .send({ email: INVITED_EMAIL, password, client: "mobile" });
}

// A 404 for an unusable invitation is only valid with the specific detail:
// an unregistered route also answers 404, with a different detail.
function expectUnusable(response: request.Response) {
  expect(response.status).toBe(404);
  expect(response.type).toBe("application/problem+json");
  expect(response.body).toMatchObject({
    title: "Not Found",
    detail: UNUSABLE_DETAIL,
  });
}

async function storedPasswordHash() {
  const user = await testDatabase.database.user.findUniqueOrThrow({
    where: { email: INVITED_EMAIL },
  });
  return user.passwordHash;
}

describe("invitation lookup", () => {
  it("finds a usable invitation without consuming it", async () => {
    const { token } = await registerInvited();
    advance(HOUR);

    const response = await lookup({ token });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      name: "Invited Person",
      email: INVITED_EMAIL,
      expiresAt: new Date(NOW.getTime() + 48 * HOUR).toISOString(),
    });
    expect((await accept({ token, password: NEW_PASSWORD })).status).toBe(204);
  });

  it("answers the same 404 for unknown, used, replaced and 48-hour-old invitations", async () => {
    const used = await registerInvited();
    expect(
      (await accept({ token: used.token, password: NEW_PASSWORD })).status,
    ).toBe(204);
    const other = await testDatabase.database.user.create({
      data: userData({ passwordHash: null, email: "other@distrilux.com.br" }),
    });
    const replaced = await issueNewInvitation(other.id);
    await issueNewInvitation(other.id);
    const old = await issueNewInvitation(other.id);
    advance(48 * HOUR);

    const responses = [
      await lookup({ token: randomBytes(32).toString("base64url") }),
      await lookup({ token: used.token }),
      await lookup({ token: replaced }),
      await lookup({ token: old }),
    ];

    for (const response of responses) {
      expectUnusable(response);
    }
    const comparable = responses.map(({ body }) => ({
      title: body.title as unknown,
      detail: body.detail as unknown,
    }));
    expect(new Set(comparable.map((item) => JSON.stringify(item))).size).toBe(
      1,
    );
  });
});

describe("invitation acceptance", () => {
  it("sets the password without opening a session, then the person signs in", async () => {
    const { token } = await registerInvited();

    const response = await accept({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(response.headers).not.toHaveProperty("set-cookie");
    expect(
      await testDatabase.database.session.count({
        where: { user: { email: INVITED_EMAIL } },
      }),
    ).toBe(0);
    const signIn = await signInAs(NEW_PASSWORD);
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.email).toBe(INVITED_EMAIL);
    const listed = await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${await adminToken()}`);
    const item = (listed.body as { email: string; status: string }[]).find(
      ({ email }) => email === INVITED_EMAIL,
    );
    expect(item?.status).toBe("ACTIVE");
  });

  it("refuses a second use and keeps the first password", async () => {
    const { token } = await registerInvited();
    expect((await accept({ token, password: NEW_PASSWORD })).status).toBe(204);

    const second = await accept({ token, password: "another-password-1" });

    expectUnusable(second);
    expect((await signInAs(NEW_PASSWORD)).status).toBe(200);
    expect((await signInAs("another-password-1")).status).toBe(401);
  });

  it("accepts an invitation issued 47 hours and 59 minutes ago", async () => {
    const { token } = await registerInvited();
    advance(47 * HOUR + 59 * MINUTE);

    const response = await accept({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(204);
  });

  it("refuses an invitation issued exactly 48 hours ago and sets no password", async () => {
    const { token } = await registerInvited();
    advance(48 * HOUR);

    const response = await accept({ token, password: NEW_PASSWORD });

    expectUnusable(response);
    expect(await storedPasswordHash()).toBeNull();
  });

  it("lets exactly one of two concurrent acceptances win", async () => {
    const { token } = await registerInvited();
    const passwords = ["first-password-1", "second-password-2"];

    const responses = await Promise.all(
      passwords.map((password) => accept({ token, password })),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([204, 404]);
    const attempts = responses.map((response, index) => ({
      response,
      password: passwords[index] ?? "",
    }));
    const won = attempts.filter(({ response }) => response.status === 204);
    const lost = attempts.filter(({ response }) => response.status === 404);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    for (const { response } of lost) {
      expectUnusable(response);
    }
    expect((await signInAs(won[0]?.password ?? "")).status).toBe(200);
    expect((await signInAs(lost[0]?.password ?? "")).status).toBe(401);
  });

  it.each([
    ["7 characters", "short-7"],
    ["more than 72 bytes in UTF-8", "é".repeat(37)],
  ])(
    "rejects a password with %s and keeps the invitation usable",
    async (_label, password) => {
      const { token } = await registerInvited();

      const response = await accept({ token, password });

      expect(response.status).toBe(400);
      expect(response.type).toBe("application/problem+json");
      expect(response.body).toMatchObject({
        title: "Validation Error",
        status: 400,
      });
      expect(await storedPasswordHash()).toBeNull();
      expect((await accept({ token, password: NEW_PASSWORD })).status).toBe(
        204,
      );
    },
  );

  it.each([
    ["accept", "without a token", { password: NEW_PASSWORD }],
    ["accept", "with a non-string token", { token: 7, password: NEW_PASSWORD }],
    [
      "accept",
      "with an unexpected property",
      { token: "x", password: NEW_PASSWORD, extra: true },
    ],
    ["lookup", "without a token", {}],
    ["lookup", "with a non-string token", { token: 7 }],
    ["lookup", "with an unexpected property", { token: "x", extra: true }],
  ])(
    "rejects %s %s with validation Problem Details",
    async (route, _l, body) => {
      const response = await request(app)
        .post(`/api/v1/invitations/${route}`)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.type).toBe("application/problem+json");
      expect(response.body).toMatchObject({ title: "Validation Error" });
    },
  );

  it("refuses the previous invitation after a new one is issued", async () => {
    const { userId, token: previous } = await registerInvited();
    const current = await issueNewInvitation(userId);

    expectUnusable(await accept({ token: previous, password: NEW_PASSWORD }));
    expect(await storedPasswordHash()).toBeNull();
    expect(
      (await accept({ token: current, password: NEW_PASSWORD })).status,
    ).toBe(204);
  });
});

describe("invitation token secrecy", () => {
  it("does not cache the lookup or the acceptance", async () => {
    const { token } = await registerInvited();

    const found = await lookup({ token });
    const accepted = await accept({ token, password: NEW_PASSWORD });

    expect(found.status).toBe(200);
    expect(found.headers["cache-control"]).toContain("no-store");
    expect(accepted.status).toBe(204);
    expect(accepted.headers["cache-control"]).toContain("no-store");
  });

  it("keeps the token and the password out of the logs", async () => {
    const { token } = await registerInvited();
    captured.logs = "";

    const response = await accept({ token, password: NEW_PASSWORD });
    await new Promise((resolve) => setImmediate(resolve));

    expect(response.status).toBe(204);
    // Positive control: without it, an empty capture would prove nothing.
    expect(captured.logs.includes("/api/v1/invitations/accept")).toBe(true);
    // Booleans only, so that a failure never prints a secret.
    expect(captured.logs.includes(token)).toBe(false);
    expect(captured.logs.includes(NEW_PASSWORD)).toBe(false);
  });
});
