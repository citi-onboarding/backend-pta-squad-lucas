import request from "supertest";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
  ErpSyncService,
  RunRecord,
} from "../modules/erp-sync/erp-sync.service.js";
import { createTestEnvironment } from "../../tests/support/test-environment.js";
import type { Database } from "../shared/database/create-database.js";
import { createApp } from "./create-app.js";

const adminToken = "invented-admin-token-for-app-tests-0123456789";

function createDatabaseDouble() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ result: 1 }]),
  } as unknown as Database;
}

// The service is the boundary of the module, so it is the double here.
function createServiceDouble() {
  const startedAt = new Date("2026-11-27T10:00:00.000Z");
  return {
    startRun: vi.fn<ErpSyncService["startRun"]>(() =>
      Promise.resolve({
        run: { id: "run-1", kind: "MANUAL", startedAt },
        completion: new Promise<RunRecord>(() => undefined),
      }),
    ),
    getStatus: vi.fn<ErpSyncService["getStatus"]>(() =>
      Promise.resolve({
        lastSuccessfulSyncAt: startedAt,
        running: false,
        erpAvailable: true,
      }),
    ),
    listRuns: vi.fn<ErpSyncService["listRuns"]>(() => Promise.resolve([])),
    recoverInterruptedRuns: vi.fn(),
    waitForIdle: vi.fn(),
  };
}

function createTestApp(
  environment = createTestEnvironment({ ADMIN_API_TOKEN: adminToken }),
) {
  const service = createServiceDouble();
  const app = createApp({
    database: createDatabaseDouble(),
    environment,
    erpSyncService: service,
  });
  return { app, service };
}

describe("createApp ERP synchronization routes", () => {
  it("serves the synchronization status without credentials", async () => {
    const { app, service } = createTestApp();

    const response = await request(app).get("/api/v1/sync/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      lastSuccessfulSyncAt: "2026-11-27T10:00:00.000Z",
      running: false,
      erpAvailable: true,
    });
    expect(service.getStatus).toHaveBeenCalledTimes(1);
  });

  // Administrator access by session is covered with PostgreSQL in
  // create-app-role-authorization.integration.test.ts.
  it("keeps the run list closed to missing, wrong and static tokens", async () => {
    const { app, service } = createTestApp();

    const withoutToken = await request(app).get("/api/v1/sync/runs");
    const wrongToken = await request(app)
      .get("/api/v1/sync/runs")
      .set("Authorization", `Bearer ${adminToken}x`);
    const withToken = await request(app)
      .get("/api/v1/sync/runs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(withoutToken.status).toBe(401);
    expect(wrongToken.status).toBe(401);
    expect(withToken.status).toBe(401);
    expect(service.listRuns).not.toHaveBeenCalled();
  });

  it("keeps the manual run closed to missing, wrong and static tokens", async () => {
    const { app, service } = createTestApp();

    const withoutToken = await request(app).post("/api/v1/sync/run");
    const wrongToken = await request(app)
      .post("/api/v1/sync/run")
      .set("Authorization", "Bearer not-the-token");
    expect(service.startRun).not.toHaveBeenCalled();
    const withToken = await request(app)
      .post("/api/v1/sync/run")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(withoutToken.status).toBe(401);
    expect(wrongToken.status).toBe(401);
    expect(withToken.status).toBe(401);
    expect(service.startRun).not.toHaveBeenCalled();
  });

  it("refuses every administrator request when no token is configured, but still serves the status", async () => {
    const { app, service } = createTestApp(createTestEnvironment());

    const runs = await request(app)
      .get("/api/v1/sync/runs")
      .set("Authorization", `Bearer ${adminToken}`);
    const run = await request(app)
      .post("/api/v1/sync/run")
      .set("Authorization", `Bearer ${adminToken}`);
    const status = await request(app).get("/api/v1/sync/status");

    expect(runs.status).toBe(401);
    expect(run.status).toBe(401);
    expect(status.status).toBe(200);
    expect(service.listRuns).not.toHaveBeenCalled();
    expect(service.startRun).not.toHaveBeenCalled();
  });

  it("publishes the synchronization routes in the OpenAPI document", async () => {
    const { app } = createTestApp();

    const contract = await request(app).get("/openapi.json").expect(200);

    expect(Object.keys(contract.body.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/sync/status",
        "/api/v1/sync/runs",
        "/api/v1/sync/run",
      ]),
    );
  });

  // The routes and the scheduler must share one service, or both could run at once.
  it("requires the shared synchronization service", () => {
    expectTypeOf<
      Parameters<typeof createApp>[0]["erpSyncService"]
    >().toEqualTypeOf<ErpSyncService>();
  });
});
