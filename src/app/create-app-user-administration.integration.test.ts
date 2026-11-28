import { createHash, randomBytes, randomUUID } from "node:crypto";

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

import { customerData, userData } from "../../tests/support/data-factories.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../tests/support/test-database.js";
import { createTestEnvironment } from "../../tests/support/test-environment.js";
import type { ErpSyncService } from "../modules/erp-sync/erp-sync.service.js";
import { hashPassword } from "../shared/security/password.js";
import { createApp } from "./create-app.js";

// Invented values that exist only inside the isolated test database and app.
const PASSWORD = "admin-test-password";
const NOW = new Date("2026-03-02T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const ADMIN_EMAIL = "lucas@distrilux.com.br";

let testDatabase: TestDatabase;
let passwordHash: string;
let app: ReturnType<typeof createApp>;
let adminId: string;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  passwordHash = await hashPassword(PASSWORD);
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
  const { database } = testDatabase;
  // Cascades to sessions and, once it exists, to user_invitations.
  await database.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "customers" CASCADE',
  );
  const admin = await database.user.create({
    data: userData({
      name: "Lucas Moura",
      email: ADMIN_EMAIL,
      role: "ADMIN" as const,
      passwordHash,
    }),
  });
  adminId = admin.id;
});

afterEach(() => {
  vi.setSystemTime(NOW);
});

// A session row inserted directly keeps the administrator's last login date
// empty and is always fresh at the controlled instant.
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

async function asAdmin(method: "get" | "post", path: string, body?: object) {
  const agent = request(app);
  const pending = agent[method](path).set(
    "Authorization",
    `Bearer ${await adminToken()}`,
  );
  return body ? pending.send(body) : pending;
}

function advance(milliseconds: number) {
  vi.setSystemTime(new Date(Date.now() + milliseconds));
}

async function userCount() {
  return testDatabase.database.user.count();
}

// Zero while the invitation table does not exist yet.
async function invitationCount(): Promise<number> {
  const { database } = testDatabase;
  const [row] = await database.$queryRaw<
    { present: boolean }[]
  >`SELECT to_regclass('public.user_invitations') IS NOT NULL AS present`;
  if (!row?.present) {
    return 0;
  }
  const [counted] = await database.$queryRaw<
    { total: number }[]
  >`SELECT count(*)::int AS total FROM user_invitations`;
  return counted?.total ?? 0;
}

async function register(body: object) {
  return asAdmin("post", "/api/v1/users", body);
}

async function listUsers() {
  const response = await asAdmin("get", "/api/v1/users");
  expect(response.status).toBe(200);
  return response.body as {
    id: string;
    email: string;
    status: string;
    invitationExpiresAt: string | null;
    lastLoginAt: string | null;
  }[];
}

async function registerManager(email = "invited@example.test") {
  const response = await register({
    name: "Invited Person",
    email,
    role: "MANAGER",
  });
  expect(response.status).toBe(201);
  return response.body as {
    user: { id: string; email: string };
    invitation: { token: string; expiresAt: string };
  };
}

async function expectNothingCreated(users: number, invitations: number) {
  expect(await userCount()).toBe(users);
  expect(await invitationCount()).toBe(invitations);
}

describe("user list with account status", () => {
  const SEEDED = [
    ["Patrícia Lins", "patricia@distrilux.com.br", "SELLER"],
    ["Juliana Freitas", "juliana@distrilux.com.br", "SELLER"],
    ["Carla Menezes", "carla@distrilux.com.br", "SELLER"],
    ["Marcos Viana", "marcos@distrilux.com.br", "SELLER"],
    ["Fernanda Prado", "fernanda@distrilux.com.br", "MANAGER"],
    ["Sérgio Barros", "sergio@distrilux.com.br", "FINANCE"],
    ["Rodrigo Alves", "rodrigo@distrilux.com.br", "SELLER"],
  ] as const;

  it("lists seeded users as active, ordered by name, with the ERP seller name", async () => {
    for (const [name, email, role] of SEEDED) {
      await testDatabase.database.user.create({
        data: userData({
          name,
          email,
          role,
          passwordHash,
          erpSellerName: role === "SELLER" ? name : null,
        }),
      });
    }

    const response = await asAdmin("get", "/api/v1/users");

    expect(response.status).toBe(200);
    const items = response.body as Record<string, unknown>[];
    expect(items.map((item) => item.name)).toEqual([
      "Carla Menezes",
      "Fernanda Prado",
      "Juliana Freitas",
      "Lucas Moura",
      "Marcos Viana",
      "Patrícia Lins",
      "Rodrigo Alves",
      "Sérgio Barros",
    ]);
    for (const item of items) {
      expect(item).toEqual({
        id: expect.any(String),
        name: item.name,
        email: item.email,
        role: item.role,
        erpSellerName: item.role === "SELLER" ? item.name : null,
        lastLoginAt: null,
        status: "ACTIVE",
        invitationExpiresAt: null,
      });
    }
  });

  it("shows the last sign-in instant as the last access date", async () => {
    const lastLoginAt = new Date("2026-02-20T09:30:00.000Z");
    const user = await testDatabase.database.user.create({
      data: userData({ passwordHash, lastLoginAt }),
    });

    const item = (await listUsers()).find(({ id }) => id === user.id);

    expect(new Date(item?.lastLoginAt ?? "").getTime()).toBe(
      lastLoginAt.getTime(),
    );
  });

  it("shows a user registered 47 hours ago as invited with the expiry date", async () => {
    const { user, invitation } = await registerManager();
    advance(47 * HOUR);

    const item = (await listUsers()).find(({ id }) => id === user.id);

    expect(item?.status).toBe("INVITED");
    expect(new Date(item?.invitationExpiresAt ?? "").getTime()).toBe(
      NOW.getTime() + 48 * HOUR,
    );
    expect(invitation.expiresAt).toBe(item?.invitationExpiresAt);
  });

  it("shows an invitation registered exactly 48 hours ago as expired", async () => {
    const { user } = await registerManager();
    advance(48 * HOUR);

    const item = (await listUsers()).find(({ id }) => id === user.id);

    expect(item?.status).toBe("INVITATION_EXPIRED");
    expect(item?.invitationExpiresAt).toBeNull();
  });

  it("never lists a password hash, an invitation token or its digest", async () => {
    const { invitation } = await registerManager();
    const digests = [
      createHash("sha256").update(invitation.token).digest("hex"),
      createHash("sha256").update(invitation.token).digest("base64url"),
    ];

    const response = await asAdmin("get", "/api/v1/users");

    expect(response.status).toBe(200);
    expect(response.text).not.toMatch(/hash|digest|token/i);
    expect(response.text.includes(passwordHash)).toBe(false);
    expect(response.text.includes(invitation.token)).toBe(false);
    for (const digest of digests) {
      expect(response.text.includes(digest)).toBe(false);
    }
  });
});

describe("user registration with an invitation", () => {
  it("registers a manager with a 48-hour invitation that is not cacheable", async () => {
    const response = await register({
      name: "Fernanda Prado",
      email: "fernanda@distrilux.com.br",
      role: "MANAGER",
    });

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toEqual({
      user: {
        id: expect.any(String),
        name: "Fernanda Prado",
        email: "fernanda@distrilux.com.br",
        role: "MANAGER",
        erpSellerName: null,
        lastLoginAt: null,
        status: "INVITED",
        invitationExpiresAt: new Date(NOW.getTime() + 48 * HOUR).toISOString(),
      },
      invitation: {
        token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: new Date(NOW.getTime() + 48 * HOUR).toISOString(),
      },
    });
  });

  it("registers a seller with an available ERP seller name", async () => {
    await testDatabase.database.customer.create({
      data: customerData({ erpSellerName: "Ana Souza" }),
    });

    const response = await register({
      name: "Ana Souza",
      email: "ana@distrilux.com.br",
      role: "SELLER",
      erpSellerName: "Ana Souza",
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      role: "SELLER",
      erpSellerName: "Ana Souza",
    });
  });

  it("stores the email in lowercase", async () => {
    const response = await register({
      name: "Nova Pessoa",
      email: "Nova.Pessoa@DistriLux.com.br",
      role: "FINANCE",
    });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe("nova.pessoa@distrilux.com.br");
    const stored = await testDatabase.database.user.findUnique({
      where: { email: "nova.pessoa@distrilux.com.br" },
    });
    expect(stored).not.toBeNull();
  });

  it("refuses an email already used in another letter case", async () => {
    await testDatabase.database.user.create({
      data: userData({ email: "patricia@distrilux.com.br", passwordHash }),
    });
    const users = await userCount();
    const invitations = await invitationCount();

    const response = await register({
      name: "Another Patricia",
      email: "Patricia@distrilux.com.br",
      role: "MANAGER",
    });

    expect(response.status).toBe(409);
    expect(response.type).toBe("application/problem+json");
    expect(response.body.conflictField).toBe("email");
    await expectNothingCreated(users, invitations);
  });

  it.each([
    ["a seller without an ERP seller name", { role: "SELLER" }],
    [
      "a finance user with an ERP seller name",
      { role: "FINANCE", erpSellerName: "Ana Souza" },
    ],
    [
      "a seller whose ERP seller name no customer carries",
      { role: "SELLER", erpSellerName: "Nobody Known" },
    ],
    ["a blank name", { role: "MANAGER", name: "   " }],
    ["an invalid email", { role: "MANAGER", email: "not-an-email" }],
    ["an unknown role", { role: "OWNER" }],
    ["an unexpected property", { role: "MANAGER", admin: true }],
  ])("rejects %s with validation Problem Details", async (_label, override) => {
    await testDatabase.database.customer.create({
      data: customerData({ erpSellerName: "Ana Souza" }),
    });
    const users = await userCount();
    const invitations = await invitationCount();

    const response = await register({
      name: "Some Person",
      email: "some.person@distrilux.com.br",
      ...override,
    });

    expect(response.status).toBe(400);
    expect(response.type).toBe("application/problem+json");
    expect(response.body).toMatchObject({
      title: "Validation Error",
      status: 400,
    });
    await expectNothingCreated(users, invitations);
  });

  it("refuses an ERP seller name already linked to a user", async () => {
    await testDatabase.database.customer.create({
      data: customerData({ erpSellerName: "Patrícia Lins" }),
    });
    await testDatabase.database.user.create({
      data: userData({
        role: "SELLER" as const,
        erpSellerName: "Patrícia Lins",
        passwordHash,
      }),
    });
    const users = await userCount();
    const invitations = await invitationCount();

    const response = await register({
      name: "Second Seller",
      email: "second.seller@distrilux.com.br",
      role: "SELLER",
      erpSellerName: "Patrícia Lins",
    });

    expect(response.status).toBe(409);
    expect(response.type).toBe("application/problem+json");
    expect(response.body.conflictField).toBe("erpSellerName");
    await expectNothingCreated(users, invitations);
  });

  it("stores only the digest of the invitation token", async () => {
    const { invitation } = await registerManager();

    const rows = await testDatabase.database.$queryRawUnsafe<
      Record<string, unknown>[]
    >("SELECT * FROM user_invitations");

    expect(rows).toHaveLength(1);
    // Booleans only, so that a failure never prints the token.
    expect(JSON.stringify(rows).includes(invitation.token)).toBe(false);
    const digests = [
      createHash("sha256").update(invitation.token).digest("hex"),
      createHash("sha256").update(invitation.token).digest("base64url"),
    ];
    expect(digests.includes(String(rows[0]?.token_digest))).toBe(true);
  });
});

describe("new invitation for a user without a password", () => {
  it("replaces an expired invitation with a new 48-hour one", async () => {
    const { user } = await registerManager();
    advance(48 * HOUR);

    const response = await asAdmin(
      "post",
      `/api/v1/users/${user.id}/invitations`,
    );

    expect(response.status).toBe(201);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: new Date(NOW.getTime() + 96 * HOUR).toISOString(),
    });
    const item = (await listUsers()).find(({ id }) => id === user.id);
    expect(item?.status).toBe("INVITED");
  });

  // The acceptance route belongs to cycle 3, whose Red covers refusing the
  // replaced token over HTTP; here the stored state is checked.
  it("revokes the previous invitation when a new one is issued", async () => {
    const { user, invitation } = await registerManager();

    const response = await asAdmin(
      "post",
      `/api/v1/users/${user.id}/invitations`,
    );

    expect(response.status).toBe(201);
    const rows = await testDatabase.database.$queryRawUnsafe<
      { token_digest: string; revoked_at: Date | null }[]
    >("SELECT token_digest, revoked_at FROM user_invitations");
    expect(rows).toHaveLength(2);
    const oldDigests = [
      createHash("sha256").update(invitation.token).digest("hex"),
      createHash("sha256").update(invitation.token).digest("base64url"),
    ];
    const previous = rows.find((row) => oldDigests.includes(row.token_digest));
    expect(previous?.revoked_at).not.toBeNull();
    expect(rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
  });

  it("refuses a user who already has a password", async () => {
    const active = await testDatabase.database.user.create({
      data: userData({ passwordHash }),
    });
    const users = await userCount();
    const invitations = await invitationCount();

    const response = await asAdmin(
      "post",
      `/api/v1/users/${active.id}/invitations`,
    );

    expect(response.status).toBe(409);
    expect(response.type).toBe("application/problem+json");
    await expectNothingCreated(users, invitations);
  });

  it("answers 404 for a well-formed id that matches no user", async () => {
    const response = await asAdmin(
      "post",
      `/api/v1/users/${randomUUID()}/invitations`,
    );

    expect(response.status).toBe(404);
    expect(response.type).toBe("application/problem+json");
    // The unknown route answers 404 too, so the title is asserted: the
    // missing-user problem is the only 404 with this detail.
    expect(response.body.detail).not.toMatch(/Route .* was not found/);
  });
});

describe("available ERP seller names", () => {
  it("excludes names linked to a user, repeated names and empty ones", async () => {
    const { database } = testDatabase;
    for (const erpSellerName of [
      "Patrícia Lins",
      "Ana Souza",
      "Ana Souza",
      "",
    ]) {
      await database.customer.create({ data: customerData({ erpSellerName }) });
    }
    await database.customer.create({
      data: customerData({ erpSellerName: null }),
    });
    await database.user.create({
      data: userData({
        role: "SELLER" as const,
        erpSellerName: "Patrícia Lins",
        passwordHash,
      }),
    });

    const response = await asAdmin("get", "/api/v1/users/erp-seller-names");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(["Ana Souza"]);
  });

  it("returns the names in alphabetical order", async () => {
    for (const erpSellerName of ["Zeca Lima", "Ana Souza", "Bruno Reis"]) {
      await testDatabase.database.customer.create({
        data: customerData({ erpSellerName }),
      });
    }

    const response = await asAdmin("get", "/api/v1/users/erp-seller-names");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(["Ana Souza", "Bruno Reis", "Zeca Lima"]);
  });

  it("returns an empty list without synchronized customers", async () => {
    const response = await asAdmin("get", "/api/v1/users/erp-seller-names");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});

describe("sign-in of a user without a password", () => {
  it("answers the same 401 as an unknown email and opens no session", async () => {
    await registerManager("invited.signin@example.test");
    const { database } = testDatabase;
    const sessionsBefore = await database.session.count();

    const invited = await request(app).post("/api/v1/auth/login").send({
      email: "Invited.SignIn@example.test",
      password: "any-password-at-all",
      client: "mobile",
    });
    const unknown = await request(app).post("/api/v1/auth/login").send({
      email: "nobody@example.test",
      password: "any-password-at-all",
      client: "mobile",
    });

    const comparable = (response: request.Response) => ({
      status: response.status,
      contentType: response.headers["content-type"],
      title: response.body.title as unknown,
      detail: response.body.detail as unknown,
      type: response.body.type as unknown,
    });
    expect(invited.status).toBe(401);
    expect(comparable(invited)).toEqual(comparable(unknown));
    expect(invited.body).not.toHaveProperty("accessToken");
    expect(await database.session.count()).toBe(sessionsBefore);
    const stored = await database.user.findUniqueOrThrow({
      where: { email: "invited.signin@example.test" },
    });
    expect(stored.lastLoginAt).toBeNull();
  });
});
