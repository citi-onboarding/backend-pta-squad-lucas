import express, { type RequestHandler } from "express";
import { pinoHttp } from "pino-http";
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
import { AuthenticationRepository } from "../modules/authentication/authentication.repository.js";
import { createAuthenticationRouter } from "../modules/authentication/authentication.router.js";
import { AuthenticationService } from "../modules/authentication/authentication.service.js";
import { createRoleGuard } from "../modules/authentication/role-guard.js";
import {
  createSessionToken,
  digestSessionToken,
} from "../modules/authentication/session-token.js";
import type { Role } from "../shared/database/generated/enums.js";
import { problemHandler } from "../shared/http/problem.js";
import {
  getRequestIdentity,
  type RequestIdentity,
} from "../shared/http/request-identity.js";
import { hashPassword, verifyPassword } from "../shared/security/password.js";

// Invented values that exist only inside the isolated test database and app.
const PASSWORD = "role-guard-test-password";
const SIGN_IN_AT = new Date("2026-02-01T08:00:00.000Z");
const ONE_HOUR_MS = 60 * 60 * 1000;

let testDatabase: TestDatabase;
let passwordHash: string;

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// No production operation is restricted to these roles yet, so the guard is
// mounted on test operations over the real authentication service and database.
function buildApp(database: TestDatabase["database"] = testDatabase.database) {
  const repository = new AuthenticationRepository(database);
  const sessionCheck = vi.spyOn(repository, "renewActiveSession");
  const service = new AuthenticationService(
    repository,
    verifyPassword,
    { generate: createSessionToken, digest: digestSessionToken },
    () => new Date(),
  );
  const requireRole = createRoleGuard(service);
  const operation = vi.fn<(identity: RequestIdentity) => void>();
  const handler: RequestHandler = (_request, response) => {
    const identity = getRequestIdentity(response);
    operation(identity);
    response.json(identity);
  };

  const app = express();
  app.use(pinoHttp({ level: "silent" }));
  app.use(express.json());
  app.use("/api/v1/auth", createAuthenticationRouter(service));
  app.get("/manager", requireRole("MANAGER"), handler);
  app.get("/manager-or-finance", requireRole("MANAGER", "FINANCE"), handler);
  app.get("/seller", requireRole("SELLER"), handler);
  app.get("/unguarded", handler);
  app.use(problemHandler);

  return { app, operation, sessionCheck };
}

type App = ReturnType<typeof buildApp>["app"];

async function createUser(role: Role, erpSellerName: string | null = null) {
  return testDatabase.database.user.create({
    data: { ...userData({ role, passwordHash }), erpSellerName },
  });
}

async function signIn(app: App, role: Role, erpSellerName?: string) {
  const user = await createUser(role, erpSellerName);
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: PASSWORD, client: "mobile" });
  expect(response.status).toBe(200);
  return {
    userId: user.id,
    authorization: `Bearer ${response.body.accessToken as string}`,
  };
}

// Returns the Cookie header explicitly: the test agent speaks HTTP and the
// session cookie is Secure.
async function signInOnWeb(app: App, role: Role) {
  const user = await createUser(role);
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: PASSWORD, client: "web" });
  expect(response.status).toBe(200);
  const header = response.headers["set-cookie"] as unknown;
  const pair = Array.isArray(header) ? String(header[0]).split(";")[0] : "";
  expect(pair?.startsWith("__Host-session=")).toBe(true);
  return pair ?? "";
}

async function sessionOf(userId: string) {
  return testDatabase.database.session.findFirstOrThrow({
    where: { userId },
    select: { lastUsedAt: true, user: { select: { lastLoginAt: true } } },
  });
}

describe("operations restricted to declared roles", () => {
  it("allows the only declared role with a Bearer credential", async () => {
    const { app, operation } = buildApp();
    const manager = await signIn(app, "MANAGER");

    const response = await request(app)
      .get("/manager")
      .set("Authorization", manager.authorization);

    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("allows the only declared role with the session cookie", async () => {
    const { app, operation } = buildApp();
    const cookie = await signInOnWeb(app, "MANAGER");

    const response = await request(app).get("/manager").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("allows any of several declared roles", async () => {
    const { app, operation } = buildApp();

    for (const role of ["MANAGER", "FINANCE"] as const) {
      const user = await signIn(app, role);
      const response = await request(app)
        .get("/manager-or-finance")
        .set("Authorization", user.authorization);

      expect(response.status).toBe(200);
    }
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it.each(["SELLER", "ADMIN"] as const)(
    "forbids the undeclared role %s and still counts the session use",
    async (role) => {
      const { app, operation } = buildApp();
      const user = await signIn(app, role);
      const usedAt = new Date(SIGN_IN_AT.getTime() + ONE_HOUR_MS);
      vi.setSystemTime(usedAt);

      const response = await request(app)
        .get("/manager-or-finance")
        .set("Authorization", user.authorization);

      expect(response.status).toBe(403);
      expect(response.type).toBe("application/problem+json");
      expect(response.body).toMatchObject({
        title: "Forbidden",
        detail: "Your role does not allow this operation.",
      });
      const session = await sessionOf(user.userId);
      expect(session.lastUsedAt).toEqual(usedAt);
      expect(session.user.lastLoginAt).toEqual(SIGN_IN_AT);
      expect(operation).not.toHaveBeenCalled();
    },
  );

  it("refuses requests without a valid session and renews none", async () => {
    const { app, operation } = buildApp();
    const idle = await signIn(app, "MANAGER");
    vi.setSystemTime(new Date(SIGN_IN_AT.getTime() + 8 * ONE_HOUR_MS));

    for (const authorization of [
      undefined,
      `Bearer ${"A".repeat(43)}`,
      idle.authorization,
    ]) {
      const pending = request(app).get("/manager");
      const response = await (authorization
        ? pending.set("Authorization", authorization)
        : pending);

      expect(response.status).toBe(401);
      expect(response.type).toBe("application/problem+json");
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    }
    expect((await sessionOf(idle.userId)).lastUsedAt).toEqual(SIGN_IN_AT);
    expect(operation).not.toHaveBeenCalled();
  });

  it("answers a safe 500 when the decision cannot be made", async () => {
    const internalDetail = "internal-session-lookup-detail";
    const token = "B".repeat(43);
    // Only here the database, an external dependency, is a double that fails.
    const lookup = vi.fn().mockRejectedValue(new Error(internalDetail));
    const { app, operation } = buildApp({
      $queryRaw: lookup,
    } as unknown as TestDatabase["database"]);

    const response = await request(app)
      .get("/manager")
      .set("Authorization", `Bearer ${token}`);

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      title: "Internal Server Error",
      detail: "An unexpected error occurred.",
    });
    expect(response.text.includes(internalDetail)).toBe(false);
    expect(response.text.includes(token)).toBe(false);
    expect(operation).not.toHaveBeenCalled();
  });
});

describe("identity available to the allowed operation", () => {
  it("gives the seller identity from a single session check", async () => {
    const { app, operation, sessionCheck } = buildApp();
    const seller = await signIn(app, "SELLER", "Invented ERP Seller");
    sessionCheck.mockClear();

    const response = await request(app)
      .get("/seller")
      .set("Authorization", seller.authorization);

    const identity = {
      id: seller.userId,
      role: "SELLER",
      erpSellerName: "Invented ERP Seller",
    };
    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual(identity);
    expect(operation).toHaveBeenCalledWith(identity);
    expect(sessionCheck).toHaveBeenCalledTimes(1);
  });

  it("gives an empty ERP seller name to a user who has none", async () => {
    const { app } = buildApp();
    const manager = await signIn(app, "MANAGER");

    const response = await request(app)
      .get("/manager")
      .set("Authorization", manager.authorization);

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({
      id: manager.userId,
      role: "MANAGER",
      erpSellerName: null,
    });
  });

  it("fails when the identity is expected without a role restriction", async () => {
    const { app, operation } = buildApp();
    const manager = await signIn(app, "MANAGER");

    // Control: the same operation works once a restriction ran for it.
    const restricted = await request(app)
      .get("/manager")
      .set("Authorization", manager.authorization);
    expect(restricted.status).toBe(200);
    operation.mockClear();

    const response = await request(app)
      .get("/unguarded")
      .set("Authorization", manager.authorization);

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      detail: "An unexpected error occurred.",
    });
    expect(operation).not.toHaveBeenCalled();
  });
});
