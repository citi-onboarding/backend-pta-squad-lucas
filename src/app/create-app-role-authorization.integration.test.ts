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
import type {
  ErpSyncService,
  RunRecord,
} from "../modules/erp-sync/erp-sync.service.js";
import { hashPassword } from "../shared/security/password.js";
import { createApp } from "./create-app.js";

// Invented values that exist only inside the isolated test database and app.
const STATIC_TOKEN = "invented-static-admin-token-for-tests-0123456789";
const PASSWORD = "role-test-password";
const SIGN_IN_AT = new Date("2026-02-01T08:00:00.000Z");

const OPERATIONS = [
  { name: "GET /runs", method: "get", path: "/api/v1/sync/runs", ok: 200 },
  { name: "POST /run", method: "post", path: "/api/v1/sync/run", ok: 202 },
] as const;
type Operation = (typeof OPERATIONS)[number];

// The ERP service is the external boundary: a countable fake, so no ERP call
// is possible.
function createServiceDouble() {
  return {
    startRun: vi.fn<ErpSyncService["startRun"]>(() =>
      Promise.resolve({
        run: { id: "run-1", kind: "MANUAL", startedAt: SIGN_IN_AT },
        completion: new Promise<RunRecord>(() => undefined),
      }),
    ),
    getStatus: vi.fn<ErpSyncService["getStatus"]>(),
    listRuns: vi.fn<ErpSyncService["listRuns"]>(() => Promise.resolve([])),
    recoverInterruptedRuns: vi.fn(),
    waitForIdle: vi.fn(),
  };
}

let testDatabase: TestDatabase;
let passwordHash: string;
let signedInUserId: string;
let service: ReturnType<typeof createServiceDouble>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await testDatabase?.stop();
});

beforeEach(() => {
  // Only Date is faked: database and HTTP timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SIGN_IN_AT);
  service = createServiceDouble();
  app = createApp({
    database: testDatabase.database,
    environment: createTestEnvironment({
      DATABASE_URL: testDatabase.databaseUrl,
      ADMIN_API_TOKEN: STATIC_TOKEN,
    }),
    erpSyncService: service,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function signIn(
  role: "ADMIN" | "SELLER" | "MANAGER" | "FINANCE",
): Promise<string> {
  const user = await testDatabase.database.user.create({
    data: userData({ role, passwordHash }),
  });
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: PASSWORD, client: "mobile" });
  expect(response.status).toBe(200);
  signedInUserId = user.id;
  return response.body.accessToken as string;
}

// The only session of the user created by the latest sign-in.
async function latestSession() {
  return testDatabase.database.session.findFirstOrThrow({
    where: { userId: signedInUserId },
    select: { lastUsedAt: true, user: { select: { lastLoginAt: true } } },
  });
}

function call(operation: Operation, authorization?: string) {
  const pending = request(app)[operation.method](operation.path);
  return authorization ? pending.set("Authorization", authorization) : pending;
}

function serviceCalls(): number {
  return (
    service.listRuns.mock.calls.length + service.startRun.mock.calls.length
  );
}

// Returns the Cookie header explicitly: the test agent speaks HTTP and the
// session cookie is Secure.
async function signInOnWeb(): Promise<string> {
  const user = await testDatabase.database.user.create({
    data: userData({ role: "ADMIN" as const, passwordHash }),
  });
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: PASSWORD, client: "web" });
  expect(response.status).toBe(200);
  const header = response.headers["set-cookie"] as unknown;
  const pair = Array.isArray(header) ? String(header[0]).split(";")[0] : "";
  expect(pair?.startsWith("__Host-session=")).toBe(true);
  return pair ?? "";
}

describe.each(OPERATIONS)("administrator access to $name", (operation) => {
  it("allows an ADMIN session sent only as the web cookie", async () => {
    const cookie = await signInOnWeb();

    const response = await call(operation).set("Cookie", cookie);

    expect(response.status).toBe(operation.ok);
    expect(serviceCalls()).toBe(1);
  });

  it("does not replace an invalid Authorization header with a valid cookie", async () => {
    const cookie = await signInOnWeb();

    for (const authorization of ["Basic x", `Bearer ${"A".repeat(43)}`]) {
      const response = await call(operation, authorization).set(
        "Cookie",
        cookie,
      );

      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    }
    expect(serviceCalls()).toBe(0);
  });

  it("answers a safe 500 when the session lookup fails", async () => {
    const internalDetail = "internal-session-lookup-detail";
    const token = "B".repeat(43);
    // Only here the database, an external dependency, is a double that fails.
    const lookup = vi.fn().mockRejectedValue(new Error(internalDetail));
    const failingApp = createApp({
      database: { $queryRaw: lookup } as unknown as TestDatabase["database"],
      environment: createTestEnvironment(),
      erpSyncService: service,
    });

    const agent = request(failingApp);
    const response = await agent[operation.method](operation.path).set(
      "Authorization",
      `Bearer ${token}`,
    );

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(response.type).toBe("application/problem+json");
    expect(response.body).toMatchObject({
      title: "Internal Server Error",
      detail: "An unexpected error occurred.",
    });
    expect(response.text.includes(internalDetail)).toBe(false);
    expect(response.text.includes(token)).toBe(false);
    expect(serviceCalls()).toBe(0);
  });

  it("allows an ADMIN session", async () => {
    const token = await signIn("ADMIN");

    const response = await call(operation, `Bearer ${token}`);

    expect.soft(response.status).toBe(operation.ok);
    expect.soft(serviceCalls()).toBe(1);
  });

  it.each(["SELLER", "MANAGER", "FINANCE"] as const)(
    "forbids a %s session without calling the service",
    async (role) => {
      const token = await signIn(role);
      const usedAt = new Date(SIGN_IN_AT.getTime() + 60 * 60 * 1000);
      vi.setSystemTime(usedAt);

      const response = await call(operation, `Bearer ${token}`);

      expect.soft(response.status).toBe(403);
      expect.soft(response.type).toBe("application/problem+json");
      expect.soft(serviceCalls()).toBe(0);
      expect.soft(await latestSession()).toEqual({
        lastUsedAt: usedAt,
        user: { lastLoginAt: SIGN_IN_AT },
      });
    },
  );

  it("refuses the configured static token without calling the service", async () => {
    const response = await call(operation, `Bearer ${STATIC_TOKEN}`);

    expect.soft(response.status).toBe(401);
    expect.soft(serviceCalls()).toBe(0);
  });

  it("answers 401 with a challenge without a valid session", async () => {
    const signedOut = await signIn("ADMIN");
    const signOut = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${signedOut}`);
    expect(signOut.status).toBe(204);
    const idle = await signIn("ADMIN");
    const idleSession = await latestSession();
    vi.setSystemTime(new Date(SIGN_IN_AT.getTime() + 8 * 60 * 60 * 1000));

    // Results keep only a label, never the credential that was sent.
    const cases: [string, string | undefined][] = [
      ["missing", undefined],
      ["malformed", "Basic x"],
      ["unknown", `Bearer ${"A".repeat(43)}`],
      ["signed out", `Bearer ${signedOut}`],
      ["idle for 8 hours", `Bearer ${idle}`],
    ];
    const results = [];
    for (const [label, authorization] of cases) {
      const response = await call(operation, authorization);
      results.push({
        label,
        status: response.status,
        type: response.type,
        challenge: response.headers["www-authenticate"],
      });
    }

    expect(results).toEqual(
      cases.map(([label]) => ({
        label,
        status: 401,
        type: "application/problem+json",
        challenge: "Bearer",
      })),
    );
    expect(serviceCalls()).toBe(0);
    expect(await latestSession()).toEqual(idleSession);
  });
});
