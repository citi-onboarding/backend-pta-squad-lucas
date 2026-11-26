import { execFileSync } from "node:child_process";

import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "./create-database.js";

let container: StartedTestContainer;
let database: Database;

describe("ERP code uniqueness", () => {
  beforeAll(async () => {
    container = await new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: "postgres",
        POSTGRES_DB: "integration",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage(/database system is ready to accept connections/),
      )
      .start();
    const databaseUrl = `postgresql://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/integration`;
    execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
    );
    const { createDatabase } = await import("./create-database.js");
    database = createDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.$disconnect();
    await container?.stop();
  });

  it("rejects two customers with the same ERP code", async () => {
    const data = {
      erpId: "C0001",
      name: "Test Customer",
      cnpj: "23775684000107",
      city: "Recife",
      state: "PE",
      segment: "Test",
      status: "ACTIVE" as const,
      creditLimitCents: 5000000,
    };

    await database.customer.create({ data });

    await expect(
      database.customer.create({ data: { ...data, name: "Other name" } }),
    ).rejects.toMatchObject({ code: "P2002" });

    const existing = await database.customer.findUniqueOrThrow({
      where: { erpId: data.erpId },
    });
    expect(existing.name).toBe("Test Customer");
  });
});
