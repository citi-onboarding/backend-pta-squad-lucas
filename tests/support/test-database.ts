import { execFileSync } from "node:child_process";

import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";

import type { Database } from "../../src/shared/database/create-database.js";

export interface TestDatabase {
  database: Database;
  databaseUrl: string;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedTestContainer = await new GenericContainer(
    "postgres:17-alpine",
  )
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
  const { createDatabase } =
    await import("../../src/shared/database/create-database.js");
  const database = createDatabase(databaseUrl);
  return {
    database,
    databaseUrl,
    stop: async () => {
      await database.$disconnect();
      await container.stop();
    },
  };
}
