import { createHash } from "node:crypto";
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

import { userData } from "../../../tests/support/data-factories.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../../tests/support/test-database.js";
import { createTestEnvironment } from "../../../tests/support/test-environment.js";
import { createApp } from "../../app/create-app.js";
import { createDefaultErpSyncService } from "../../app/erp-sync-runtime.js";
import type { Environment } from "../../shared/config/env.js";
import { createLogger } from "../../shared/logging/logger.js";
import { hashPassword } from "../../shared/security/password.js";

const captured = vi.hoisted(() => ({ logs: "" }));

// Keeps the real logger; only its sink, an external output, goes to memory.
// Apps created with LOG_LEVEL "silent" still write nothing.
vi.mock("../../shared/logging/logger.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../shared/logging/logger.js")>();
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

// Test-only password for a fixture user created inside the isolated database.
const SELLER_PASSWORD = "seller-test-password";
const SELLER_EMAIL = "patricia@distrilux.com.br";
const SELLER_ERP_NAME = "Patrícia Lins";

let testDatabase: TestDatabase;
let app: ReturnType<typeof createApp>;
let seller: { id: string; name: string; email: string };

function buildApp(environment: Environment) {
  const { database } = testDatabase;
  const erpSyncService = createDefaultErpSyncService({
    database,
    environment,
    logger: createLogger(environment),
  });
  return createApp({ database, environment, erpSyncService });
}

beforeAll(async () => {
  testDatabase = await startTestDatabase();
  app = buildApp(
    createTestEnvironment({ DATABASE_URL: testDatabase.databaseUrl }),
  );
  seller = await testDatabase.database.user.create({
    data: userData({
      name: SELLER_ERP_NAME,
      email: SELLER_EMAIL,
      role: "SELLER" as const,
      erpSellerName: SELLER_ERP_NAME,
      passwordHash: await hashPassword(SELLER_PASSWORD),
    }),
  });
});

afterAll(async () => {
  await testDatabase?.stop();
});

describe("user authentication with PostgreSQL", () => {
  it("lets a seller sign in, read the identity, sign out and be rejected afterwards", async () => {
    const signIn = await request(app).post("/api/v1/auth/login").send({
      email: SELLER_EMAIL,
      password: SELLER_PASSWORD,
      client: "mobile",
    });
    expect(signIn.status).toBe(200);
    expect(signIn.body.tokenType).toBe("Bearer");
    expect(typeof signIn.body.accessToken).toBe("string");
    expect(signIn.body.accessToken.length).toBeGreaterThan(0);
    const accessToken = signIn.body.accessToken as string;

    const identity = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(identity.status).toBe(200);
    expect(identity.body).toEqual({
      id: seller.id,
      name: seller.name,
      email: SELLER_EMAIL,
      role: "SELLER",
      erpSellerName: SELLER_ERP_NAME,
    });

    const signOut = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(signOut.status).toBe(204);

    const afterSignOut = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(afterSignOut.status).toBe(401);
    expect(afterSignOut.type).toBe("application/problem+json");
    expect(afterSignOut.body).toMatchObject({ status: 401 });
  });

  it("records the sign-in time as the seller's last login date", async () => {
    const { database } = testDatabase;
    const email = "juliana@distrilux.com.br";
    const created = await database.user.create({
      data: userData({
        name: "Juliana Freitas",
        email,
        role: "SELLER" as const,
        erpSellerName: "Juliana Freitas",
        passwordHash: await hashPassword(SELLER_PASSWORD),
      }),
    });
    expect(created.lastLoginAt).toBeNull();

    const before = Date.now();
    const signIn = await request(app).post("/api/v1/auth/login").send({
      email,
      password: SELLER_PASSWORD,
      client: "mobile",
    });
    const after = Date.now();
    expect(signIn.status).toBe(200);

    const stored = await database.user.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stored.lastLoginAt).not.toBeNull();
    const lastLoginAt = stored.lastLoginAt?.getTime() ?? Number.NaN;
    expect(lastLoginAt).toBeGreaterThanOrEqual(before);
    expect(lastLoginAt).toBeLessThanOrEqual(after);
  });
});

describe("session rejection and identity with PostgreSQL", () => {
  const UNKNOWN_TOKEN = "A".repeat(43);

  async function createUserFixture(
    slug: string,
    role: "SELLER" | "MANAGER" = "SELLER",
  ) {
    return testDatabase.database.user.create({
      data: userData({
        email: `${slug}@example.test`,
        role,
        passwordHash: await hashPassword(SELLER_PASSWORD),
      }),
    });
  }

  async function signInToken(email: string): Promise<string> {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: SELLER_PASSWORD, client: "mobile" });
    expect(response.status).toBe(200);
    return response.body.accessToken as string;
  }

  function callProtected(route: "me" | "logout", headers: object) {
    const agent = request(app);
    const call =
      route === "me"
        ? agent.get("/api/v1/auth/me")
        : agent.post("/api/v1/auth/logout");
    return call.set(headers as Record<string, string>);
  }

  // Results carry only a label and the response, never the sent credential.
  async function collectRejections(slug: string) {
    const user = await createUserFixture(slug);
    const valid = await signInToken(user.email);
    const ended = await signInToken(user.email);
    const firstSignOut = await callProtected("logout", {
      Authorization: `Bearer ${ended}`,
    });
    expect(firstSignOut.status).toBe(204);

    // "logout with an ended session" is also the repeated sign-out.
    const credentials: [string, object][] = [
      ["no credential", {}],
      ["unknown", { Authorization: `Bearer ${UNKNOWN_TOKEN}` }],
      ["ended session", { Authorization: `Bearer ${ended}` }],
      ["other scheme", { Authorization: `Token ${valid}` }],
      ["empty bearer", { Authorization: "Bearer" }],
      [
        "malformed header with a cookie",
        { Authorization: "Basic x", Cookie: `__Host-session=${valid}` },
      ],
    ];
    const rejections = [];
    for (const route of ["me", "logout"] as const) {
      for (const [label, headers] of credentials) {
        rejections.push({
          label: `${route}: ${label}`,
          response: await callProtected(route, headers),
        });
      }
    }
    return rejections;
  }

  it("rejects every invalid credential with the same 401 Problem Details", async () => {
    const rejections = await collectRejections("rejections");

    const actual = rejections.map(({ label, response }) => ({
      label,
      status: response.status,
      contentType: response.type,
      type: response.body.type as unknown,
      title: response.body.title as unknown,
      detail: response.body.detail as unknown,
    }));
    expect(actual).toEqual(
      rejections.map(({ label }) => ({
        label,
        status: 401,
        contentType: "application/problem+json",
        type: "about:blank",
        title: "Unauthorized",
        detail: "Authentication is required.",
      })),
    );
  });

  it("announces the Bearer scheme on every rejection", async () => {
    const rejections = await collectRejections("challenge");

    expect(
      rejections.map(({ label, response }) => [
        label,
        response.headers["www-authenticate"],
      ]),
    ).toEqual(rejections.map(({ label }) => [label, "Bearer"]));
  });

  it("returns a non-seller identity with a null ERP seller name and no secrets", async () => {
    const user = await createUserFixture("manager-identity", "MANAGER");
    const token = await signInToken(user.email);

    const response = await callProtected("me", {
      Authorization: `Bearer ${token}`,
    });

    expect(response.status).toBe(200);
    // Exact equality excludes the password hash, credential and timestamps.
    expect(response.body).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "MANAGER",
      erpSellerName: null,
    });
  });

  describe("web cookie delivery", () => {
    const COOKIE_NAME = "__Host-session";

    function signInAs(email: string, client: "web" | "mobile") {
      return request(app)
        .post("/api/v1/auth/login")
        .send({ email, password: SELLER_PASSWORD, client });
    }

    function sessionCookies(response: request.Response): string[] {
      const header = response.headers["set-cookie"] as unknown;
      return Array.isArray(header) ? (header as string[]) : [];
    }

    // Splits a Set-Cookie header so that assertions never print the value.
    function parseSessionCookie(response: request.Response) {
      const cookies = sessionCookies(response);
      expect(cookies.length).toBe(1);
      const [pair = "", ...attributes] = (cookies[0] ?? "").split("; ");
      const separator = pair.indexOf("=");
      return {
        name: pair.slice(0, separator),
        value: pair.slice(separator + 1),
        attributes,
      };
    }

    // The test agent speaks HTTP, so the Secure cookie is sent explicitly.
    async function signInOnWeb(slug: string) {
      const user = await createUserFixture(slug);
      const response = await signInAs(user.email, "web");
      expect(response.status).toBe(200);
      const { value } = parseSessionCookie(response);
      return {
        user,
        response,
        value,
        cookie: { Cookie: `${COOKIE_NAME}=${value}` },
      };
    }

    it("delivers the web credential only in a protected cookie", async () => {
      const { user, response, value } = await signInOnWeb("web-sign-in");

      const cookie = parseSessionCookie(response);
      expect(cookie.name).toBe(COOKIE_NAME);
      // Exact list: no Domain, Max-Age or Expires.
      expect([...cookie.attributes].sort()).toEqual([
        "HttpOnly",
        "Path=/",
        "SameSite=Strict",
        "Secure",
      ]);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(value.length > 0).toBe(true);
      expect(response.text.includes(value)).toBe(false);
      expect(Object.keys(response.body as object)).toEqual(["user"]);
      expect(response.body.user).toMatchObject({
        id: user.id,
        email: user.email,
      });
    });

    it("reads the identity with only the session cookie", async () => {
      const { user, value, cookie } = await signInOnWeb("web-identity");

      const response = await callProtected("me", cookie);

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({ id: user.id, email: user.email });
      expect(response.text.includes(value)).toBe(false);
    });

    it("clears the cookie on sign-out and rejects the old value", async () => {
      const { cookie } = await signInOnWeb("web-sign-out");

      const signOut = await callProtected("logout", cookie);

      expect(signOut.status).toBe(204);
      const cleared = parseSessionCookie(signOut);
      expect(cleared.name).toBe(COOKIE_NAME);
      expect(cleared.value.length).toBe(0);
      expect(cleared.attributes).toEqual(
        expect.arrayContaining([
          "HttpOnly",
          "Path=/",
          "SameSite=Strict",
          "Secure",
        ]),
      );
      const expires = cleared.attributes.find((item) =>
        item.startsWith("Expires="),
      );
      expect(Date.parse(expires?.slice("Expires=".length) ?? "")).toBeLessThan(
        Date.now(),
      );
      expect((await callProtected("me", cookie)).status).toBe(401);
    });

    it("authenticates only by the Authorization header when one is sent", async () => {
      const { cookie } = await signInOnWeb("web-precedence");
      // Positive control: the cookie alone is valid.
      expect((await callProtected("me", cookie)).status).toBe(200);

      for (const authorization of ["Basic x", `Bearer ${UNKNOWN_TOKEN}`]) {
        const response = await callProtected("me", {
          ...cookie,
          Authorization: authorization,
        });
        expect(response.status).toBe(401);
      }
    });

    it("keeps the mobile Bearer delivery without any cookie", async () => {
      const user = await createUserFixture("web-mobile-regression");

      const response = await signInAs(user.email, "mobile");

      expect(response.status).toBe(200);
      expect(response.body.tokenType).toBe("Bearer");
      expect(typeof response.body.accessToken).toBe("string");
      expect(response.body.user).toMatchObject({ id: user.id });
      expect(sessionCookies(response).length).toBe(0);

      const identity = await callProtected("me", {
        Authorization: `Bearer ${response.body.accessToken as string}`,
      });

      expect(identity.status).toBe(200);
      expect.soft(response.headers["cache-control"]).toBe("no-store");
      expect.soft(identity.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("credential secrecy and ERP independence", () => {
    it("stores only the digest of the delivered credential", async () => {
      const user = await createUserFixture("secrecy-digest");
      const token = await signInToken(user.email);

      const session = await testDatabase.database.session.findFirstOrThrow({
        where: { userId: user.id },
      });

      // Booleans only, so that a failure never prints the credential.
      expect(JSON.stringify(session).includes(token)).toBe(false);
      expect(
        session.tokenDigest ===
          createHash("sha256").update(token).digest("hex"),
      ).toBe(true);
    });

    it("keeps secrets out of the logs during web and mobile flows", async () => {
      const user = await createUserFixture("secrecy-logs");
      const loggedApp = buildApp(
        createTestEnvironment({
          LOG_LEVEL: "info",
          DATABASE_URL: testDatabase.databaseUrl,
        }),
      );
      const secrets = [SELLER_PASSWORD, user.passwordHash];
      captured.logs = "";

      for (const client of ["mobile", "web"] as const) {
        const signIn = await request(loggedApp)
          .post("/api/v1/auth/login")
          .send({ email: user.email, password: SELLER_PASSWORD, client });
        expect(signIn.status).toBe(200);
        const setCookie = signIn.headers["set-cookie"] as unknown;
        const cookie = Array.isArray(setCookie)
          ? (String(setCookie[0]).split(";")[0] ?? "")
          : "";
        const token =
          client === "web"
            ? cookie.slice(cookie.indexOf("=") + 1)
            : (signIn.body.accessToken as string);
        expect(token.length).toBe(43);
        const headers: Record<string, string> =
          client === "web"
            ? { Cookie: cookie }
            : { Authorization: `Bearer ${token}` };
        const identity = await request(loggedApp)
          .get("/api/v1/auth/me")
          .set(headers);
        expect(identity.status).toBe(200);
        const signOut = await request(loggedApp)
          .post("/api/v1/auth/logout")
          .set(headers);
        expect(signOut.status).toBe(204);
        secrets.push(token, ...Object.values(headers));
      }
      await new Promise((resolve) => setImmediate(resolve));

      // Positive control: without it, an empty capture would prove nothing.
      for (const route of ["login", "me", "logout"]) {
        expect(captured.logs.includes(`/api/v1/auth/${route}`)).toBe(true);
      }
      expect(secrets.map((secret) => captured.logs.includes(secret))).toEqual(
        secrets.map(() => false),
      );
    });

    it("signs in and reads the seller identity without any outbound fetch", async () => {
      const outbound = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("ERP unreachable"));
      try {
        const signIn = await request(app).post("/api/v1/auth/login").send({
          email: SELLER_EMAIL,
          password: SELLER_PASSWORD,
          client: "mobile",
        });
        expect(signIn.status).toBe(200);
        expect(signIn.body.user.erpSellerName).toBe(SELLER_ERP_NAME);

        const identity = await callProtected("me", {
          Authorization: `Bearer ${signIn.body.accessToken as string}`,
        });

        expect(identity.status).toBe(200);
        expect(identity.body.erpSellerName).toBe(SELLER_ERP_NAME);
        expect(outbound).not.toHaveBeenCalled();
      } finally {
        outbound.mockRestore();
      }
    });
  });

  describe("sliding 8-hour expiry", () => {
    const SIGN_IN_AT = new Date("2026-02-01T08:00:00.000Z");
    const HOUR = 3_600_000;
    const MINUTE = 60_000;

    function after(milliseconds: number): Date {
      return new Date(SIGN_IN_AT.getTime() + milliseconds);
    }

    // Only Date is faked: timers used by the database and HTTP stay real.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(SIGN_IN_AT);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function openSessionFor(slug: string) {
      const user = await createUserFixture(slug);
      const token = await signInToken(user.email);
      const authorization = { Authorization: `Bearer ${token}` };
      return {
        userId: user.id,
        call: (route: "me" | "logout") => callProtected(route, authorization),
        stored: () =>
          testDatabase.database.session.findFirstOrThrow({
            where: { userId: user.id },
            select: { lastUsedAt: true, endedAt: true },
          }),
      };
    }

    it("accepts a session used 7h59 ago and renews its last use", async () => {
      const session = await openSessionFor("expiry-7h59");
      const now = after(7 * HOUR + 59 * MINUTE);
      vi.setSystemTime(now);

      const response = await session.call("me");

      expect(response.status).toBe(200);
      expect((await session.stored()).lastUsedAt).toEqual(now);
    });

    it("renews the last use on a successful sign-out", async () => {
      const session = await openSessionFor("expiry-sign-out");
      const now = after(HOUR);
      vi.setSystemTime(now);

      const response = await session.call("logout");

      expect(response.status).toBe(204);
      expect(await session.stored()).toEqual({ lastUsedAt: now, endedAt: now });
    });

    it("rejects a session idle for exactly 8 hours without changing it", async () => {
      const read = await openSessionFor("expiry-8h-read");
      const signOut = await openSessionFor("expiry-8h-sign-out");
      vi.setSystemTime(after(8 * HOUR));

      const identity = await read.call("me");
      const ended = await signOut.call("logout");

      const unchanged = { lastUsedAt: SIGN_IN_AT, endedAt: null };
      expect.soft(identity.status).toBe(401);
      expect.soft(identity.type).toBe("application/problem+json");
      expect.soft(ended.status).toBe(401);
      expect.soft(await read.stored()).toEqual(unchanged);
      expect.soft(await signOut.stored()).toEqual(unchanged);
    });

    it("keeps an active session alive beyond 8 hours from sign-in", async () => {
      const session = await openSessionFor("expiry-activity");
      vi.setSystemTime(after(7 * HOUR));
      expect((await session.call("me")).status).toBe(200);
      vi.setSystemTime(after(9 * HOUR));
      expect((await session.call("me")).status).toBe(200);
      vi.setSystemTime(after(10 * HOUR));

      expect((await session.call("me")).status).toBe(200);
    });

    it("keeps the last login date unchanged by later activity", async () => {
      const session = await openSessionFor("expiry-last-login");
      vi.setSystemTime(after(HOUR));

      expect((await session.call("me")).status).toBe(200);

      const user = await testDatabase.database.user.findUniqueOrThrow({
        where: { id: session.userId },
      });
      expect(user.lastLoginAt).toEqual(SIGN_IN_AT);
    });
  });
});

describe("sign-in rules with PostgreSQL", () => {
  // A past date makes any unwanted update of the last login date observable.
  const PREVIOUS_LOGIN = new Date("2026-01-01T12:00:00.000Z");

  async function createSellerFixture(slug: string) {
    return testDatabase.database.user.create({
      data: userData({
        name: `Seller ${slug}`,
        email: `${slug}@example.test`,
        role: "SELLER" as const,
        erpSellerName: `Seller ${slug}`,
        passwordHash: await hashPassword(SELLER_PASSWORD),
        lastLoginAt: PREVIOUS_LOGIN,
      }),
    });
  }

  function signInWith(body: object) {
    return request(app).post("/api/v1/auth/login").send(body);
  }

  function mobileCredentials(email: string, password = SELLER_PASSWORD) {
    return { email, password, client: "mobile" };
  }

  function readIdentity(accessToken: string) {
    return request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
  }

  async function expectNoSignInEffect(userId: string, sessionsBefore: number) {
    const { database } = testDatabase;
    expect(await database.session.count()).toBe(sessionsBefore);
    const stored = await database.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(stored.lastLoginAt).toEqual(PREVIOUS_LOGIN);
  }

  function expectNoCredential(response: request.Response) {
    expect(response.body).not.toHaveProperty("accessToken");
    expect(response.body).not.toHaveProperty("tokenType");
    expect(response.headers).not.toHaveProperty("set-cookie");
  }

  it("opens a session for valid credentials and returns the identity", async () => {
    const user = await createSellerFixture("valid-sign-in");

    const response = await signInWith(mobileCredentials(user.email));

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "SELLER",
      erpSellerName: user.erpSellerName,
    });
    expect(
      await testDatabase.database.session.count({
        where: { userId: user.id, endedAt: null },
      }),
    ).toBe(1);
  });

  it("keeps the second session valid after signing out of the first", async () => {
    const user = await createSellerFixture("two-sessions");
    const first = await signInWith(mobileCredentials(user.email));
    const second = await signInWith(mobileCredentials(user.email));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstToken = first.body.accessToken as string;
    const secondToken = second.body.accessToken as string;
    // Compared as a boolean so that a failure never prints a credential.
    expect(firstToken === secondToken).toBe(false);

    const signOut = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${firstToken}`);

    expect(signOut.status).toBe(204);
    expect((await readIdentity(secondToken)).status).toBe(200);
    expect((await readIdentity(firstToken)).status).toBe(401);
    const { database } = testDatabase;
    expect(await database.session.count({ where: { userId: user.id } })).toBe(
      2,
    );
    expect(
      await database.session.count({
        where: { userId: user.id, endedAt: null },
      }),
    ).toBe(1);
  });

  it("rejects an unknown email without a credential or any stored effect", async () => {
    const bystander = await createSellerFixture("unknown-email-bystander");
    const sessionsBefore = await testDatabase.database.session.count();

    const response = await signInWith(
      mobileCredentials("not-registered@example.test"),
    );

    expect(response.status).toBe(401);
    expect(response.type).toBe("application/problem+json");
    expectNoCredential(response);
    await expectNoSignInEffect(bystander.id, sessionsBefore);
  });

  it("rejects a wrong password without a credential or any stored effect", async () => {
    const user = await createSellerFixture("wrong-password");
    const sessionsBefore = await testDatabase.database.session.count();

    const response = await signInWith(
      mobileCredentials(user.email, "wrong-password"),
    );

    expect(response.status).toBe(401);
    expect(response.type).toBe("application/problem+json");
    expectNoCredential(response);
    await expectNoSignInEffect(user.id, sessionsBefore);
  });

  it("answers an unknown email and a wrong password indistinguishably", async () => {
    const user = await createSellerFixture("indistinguishable");

    const unknownEmail = await signInWith(
      mobileCredentials("also-not-registered@example.test"),
    );
    const wrongPassword = await signInWith(
      mobileCredentials(user.email, "wrong-password"),
    );

    // requestId differs per request by design, so only the fields named by the
    // specification are compared.
    const comparable = (response: request.Response) => ({
      status: response.status,
      contentType: response.headers["content-type"],
      title: response.body.title as unknown,
      detail: response.body.detail as unknown,
      type: response.body.type as unknown,
    });
    expect(comparable(unknownEmail)).toEqual(comparable(wrongPassword));
    expect(comparable(unknownEmail)).toMatchObject({
      status: 401,
      contentType: expect.stringContaining("application/problem+json"),
      title: expect.any(String),
      detail: expect.any(String),
      type: expect.any(String),
    });
  });

  it.each([
    ["a missing password", { password: undefined }],
    ["an email without @", { email: "not-an-email" }],
    ["an unknown client type", { client: "desktop" }],
    ["an unexpected property", { rememberMe: true }],
  ])(
    "rejects a body with %s without opening a session",
    async (invalidCase, override) => {
      const user = await createSellerFixture(
        `invalid-${invalidCase.replaceAll(/[^a-z]+/g, "-")}`,
      );
      const sessionsBefore = await testDatabase.database.session.count();

      // Everything except the overridden part is a valid sign-in.
      const response = await signInWith({
        ...mobileCredentials(user.email),
        ...override,
      });

      expect(response.status).toBe(400);
      expect(response.type).toBe("application/problem+json");
      expect(response.body).toMatchObject({
        title: "Validation Error",
        status: 400,
      });
      expectNoCredential(response);
      await expectNoSignInEffect(user.id, sessionsBefore);
    },
  );
});
