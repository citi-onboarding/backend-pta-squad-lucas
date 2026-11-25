import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { userData } from "../../../tests/support/data-factories.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../../tests/support/test-database.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
});

afterAll(async () => {
  await testDatabase.stop();
});

describe("user roles and e-mail", () => {
  it("accepts every defined role", async () => {
    const { database } = testDatabase;
    for (const role of ["SELLER", "MANAGER", "FINANCE", "ADMIN"] as const) {
      const created = await database.user.create({ data: userData({ role }) });
      expect(created.role).toBe(role);
    }
  });

  it("rejects a role outside the list", async () => {
    const { database } = testDatabase;
    await expect(
      database.user.create({ data: userData({ role: "UNKNOWN" as never }) }),
    ).rejects.toThrow();
  });

  it("rejects a second user with the same e-mail", async () => {
    const { database } = testDatabase;
    const data = userData();
    await database.user.create({ data });
    await expect(
      database.user.create({ data: userData({ email: data.email }) }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("seller ERP name and last access", () => {
  it("keeps the ERP name of a seller", async () => {
    const { database } = testDatabase;
    const created = await database.user.create({
      data: userData({
        role: "SELLER" as const,
        erpSellerName: "Test Seller Name",
      }),
    });
    expect(created.erpSellerName).toBe("Test Seller Name");
  });

  it("rejects a second seller with the same ERP name", async () => {
    const { database } = testDatabase;
    await database.user.create({
      data: userData({ role: "SELLER" as const, erpSellerName: "Carla M." }),
    });
    await expect(
      database.user.create({
        data: userData({ role: "SELLER" as const, erpSellerName: "Carla M." }),
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("has no last access before the first one", async () => {
    const { database } = testDatabase;
    const created = await database.user.create({ data: userData() });
    expect(created.lastLoginAt).toBeNull();
  });
});

describe("sessions", () => {
  it("records a session of a user without an end time", async () => {
    const { database } = testDatabase;
    const user = await database.user.create({ data: userData() });
    await database.session.create({ data: { userId: user.id } });
    await database.session.create({ data: { userId: user.id } });
    const found = await database.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { sessions: true },
    });
    expect(found.sessions).toHaveLength(2);
    expect(found.sessions[0]?.endedAt).toBeNull();
  });

  it("stores the end time of a session", async () => {
    const { database } = testDatabase;
    const user = await database.user.create({ data: userData() });
    const session = await database.session.create({
      data: { userId: user.id },
    });
    const endedAt = new Date("2026-11-25T12:00:00Z");
    await database.session.update({
      where: { id: session.id },
      data: { endedAt },
    });
    const found = await database.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(found.endedAt).toEqual(endedAt);
  });

  it("rejects a session of a user that does not exist", async () => {
    const { database } = testDatabase;
    await expect(
      database.session.create({ data: { userId: randomUUID() } }),
    ).rejects.toThrow();
  });
});

describe("test users from the prototype", () => {
  const plainPassword = "test-password-123";

  function runSeed(): void {
    execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testDatabase.databaseUrl,
        SEED_USER_PASSWORD: plainPassword,
      },
      stdio: "pipe",
    });
  }

  async function seededUsers() {
    return testDatabase.database.user.findMany({
      where: { email: { endsWith: "@distrilux.com.br" } },
      orderBy: { email: "asc" },
    });
  }

  it("creates the 8 people of the prototype with their roles", async () => {
    runSeed();
    const users = await seededUsers();
    expect(users.map((user) => user.email)).toEqual([
      "carla@distrilux.com.br",
      "fernanda@distrilux.com.br",
      "juliana@distrilux.com.br",
      "lucas@distrilux.com.br",
      "marcos@distrilux.com.br",
      "patricia@distrilux.com.br",
      "rodrigo@distrilux.com.br",
      "sergio@distrilux.com.br",
    ]);
    expect(users.filter((user) => user.role === "SELLER")).toHaveLength(5);
    expect(users.filter((user) => user.role === "MANAGER")).toHaveLength(1);
    expect(users.filter((user) => user.role === "FINANCE")).toHaveLength(1);
    expect(users.filter((user) => user.role === "ADMIN")).toHaveLength(1);
  });

  it("gives every seller an ERP name", async () => {
    runSeed();
    const sellers = (await seededUsers()).filter(
      (user) => user.role === "SELLER",
    );
    expect(sellers.every((seller) => seller.erpSellerName)).toBe(true);
  });

  it("stores only password hashes", async () => {
    runSeed();
    for (const user of await seededUsers()) {
      expect(user.passwordHash).not.toBe(plainPassword);
      expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    }
  });

  it("is repeatable", async () => {
    runSeed();
    runSeed();
    expect(await seededUsers()).toHaveLength(8);
  });
});
