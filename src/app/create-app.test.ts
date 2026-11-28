import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../../tests/support/test-environment.js";
import type { Database } from "../shared/database/create-database.js";
import { createLogger } from "../shared/logging/logger.js";
import { createApp } from "./create-app.js";
import { createDefaultErpSyncService } from "./erp-sync-runtime.js";

const environment = createTestEnvironment();

function createDatabaseDouble() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
  } as unknown as Database;
}

function createTestApp(database: Database) {
  const erpSyncService = createDefaultErpSyncService({
    database,
    environment,
    logger: createLogger(environment),
  });
  return createApp({ database, environment, erpSyncService });
}

describe("createApp", () => {
  it("serves liveness, readiness, and OpenAPI", async () => {
    const app = createTestApp(createDatabaseDouble());
    await request(app).get("/health/live").expect(200, { status: "ok" });
    await request(app).get("/health/ready").expect(200, { status: "ready" });
    const contract = await request(app).get("/openapi.json").expect(200);
    expect(contract.body.openapi).toBe("3.1.0");
  });

  it("returns 503 when the database is unavailable", async () => {
    const database = createDatabaseDouble();
    vi.mocked(database.$queryRaw).mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await request(createTestApp(database))
      .get("/health/ready")
      .expect(503, { status: "not-ready" });
  });

  it("uses Problem Details for unknown requests", async () => {
    const app = createTestApp(createDatabaseDouble());
    const missing = await request(app).get("/unknown").expect(404);
    expect(missing.body).toMatchObject({ title: "Not Found", status: 404 });
  });

  it("applies security and CORS headers", async () => {
    const response = await request(createTestApp(createDatabaseDouble()))
      .get("/health/live")
      .set("x-request-id", "known-request-id")
      .set("origin", "http://localhost:5173")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-request-id"]).toBe("known-request-id");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
