import express from "express";
import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  HttpProblem,
  notFoundHandler,
  problemHandler,
} from "../../shared/http/problem.js";
import { createErpSyncRouter } from "./erp-sync.router.js";
import type {
  ErpSyncService,
  RunRecord,
  StartedSync,
} from "./erp-sync.service.js";

const adminGuard: RequestHandler = (incoming, _response, next) => {
  if (incoming.get("x-test-admin") === "yes") {
    next();
    return;
  }
  next(
    new HttpProblem(
      401,
      "Unauthorized",
      "Administrator credentials are required.",
    ),
  );
};

const startedAt = new Date("2026-11-27T10:00:00.000Z");
const finishedAt = new Date("2026-11-27T10:00:07.000Z");

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "AUTOMATIC",
    startedAt,
    finishedAt,
    result: "SUCCESS",
    recordsRead: 9,
    recordsChanged: 3,
    errorDetail: null,
    ...overrides,
  };
}

// The service is the boundary of this module's HTTP layer, so it is the double.
function createServiceDouble() {
  return {
    startRun: vi.fn<ErpSyncService["startRun"]>(),
    getStatus: vi.fn<ErpSyncService["getStatus"]>(() =>
      Promise.resolve({
        lastSuccessfulSyncAt: finishedAt,
        running: false,
        erpAvailable: true,
      }),
    ),
    listRuns: vi.fn<ErpSyncService["listRuns"]>(() =>
      Promise.resolve([runRecord()]),
    ),
    recoverInterruptedRuns: vi.fn(),
    waitForIdle: vi.fn(),
  };
}

function createTestApp(service = createServiceDouble()) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/sync",
    createErpSyncRouter({
      service: service,
      adminGuard,
    }),
  );
  app.use(notFoundHandler);
  app.use(problemHandler);
  return { app, service };
}

describe("GET /api/v1/sync/status", () => {
  it("returns the last successful time, the run flag, and the ERP availability without credentials", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/api/v1/sync/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      lastSuccessfulSyncAt: "2026-11-27T10:00:07.000Z",
      running: false,
      erpAvailable: true,
    });
  });

  it("returns nulls before any run has finished", async () => {
    const service = createServiceDouble();
    service.getStatus.mockResolvedValue({
      lastSuccessfulSyncAt: null,
      running: true,
      erpAvailable: null,
    });
    const { app } = createTestApp(service);

    const response = await request(app).get("/api/v1/sync/status");

    expect(response.body).toEqual({
      lastSuccessfulSyncAt: null,
      running: true,
      erpAvailable: null,
    });
  });

  it("answers 500 without leaking when the service result breaks the contract", async () => {
    const service = createServiceDouble();
    service.getStatus.mockResolvedValue({
      lastSuccessfulSyncAt: null,
      running: "yes-leaked-value",
      erpAvailable: null,
    } as never);
    const { app } = createTestApp(service);

    const response = await request(app).get("/api/v1/sync/status");

    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(JSON.stringify(response.body)).not.toContain("yes-leaked-value");
  });
});

describe("GET /api/v1/sync/runs", () => {
  it("requires an administrator", async () => {
    const { app, service } = createTestApp();

    const response = await request(app).get("/api/v1/sync/runs");

    expect(response.status).toBe(401);
    expect(service.listRuns).not.toHaveBeenCalled();
  });

  it("returns the runs with ISO dates and 50 as the default limit", async () => {
    const { app, service } = createTestApp();

    const response = await request(app)
      .get("/api/v1/sync/runs")
      .set("x-test-admin", "yes");

    expect(response.status).toBe(200);
    expect(service.listRuns).toHaveBeenCalledWith(50);
    expect(response.body).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "AUTOMATIC",
        startedAt: "2026-11-27T10:00:00.000Z",
        finishedAt: "2026-11-27T10:00:07.000Z",
        result: "SUCCESS",
        recordsRead: 9,
        recordsChanged: 3,
        errorDetail: null,
      },
    ]);
  });

  it("shows a run in progress with no end time and no result", async () => {
    const service = createServiceDouble();
    service.listRuns.mockResolvedValue([
      runRecord({ finishedAt: null, result: null }),
    ]);
    const { app } = createTestApp(service);

    const response = await request(app)
      .get("/api/v1/sync/runs")
      .set("x-test-admin", "yes");

    expect(response.body[0]).toMatchObject({ finishedAt: null, result: null });
  });

  it("passes an explicit limit to the service", async () => {
    const { app, service } = createTestApp();

    await request(app)
      .get("/api/v1/sync/runs?limit=2")
      .set("x-test-admin", "yes")
      .expect(200);

    expect(service.listRuns).toHaveBeenCalledWith(2);
  });

  it("accepts the ceiling of 100", async () => {
    const { app, service } = createTestApp();

    await request(app)
      .get("/api/v1/sync/runs?limit=100")
      .set("x-test-admin", "yes")
      .expect(200);

    expect(service.listRuns).toHaveBeenCalledWith(100);
  });

  it.each(["101", "0", "-1", "abc", "1.5"])(
    "answers 400 as a problem response for limit=%s",
    async (limit) => {
      const { app, service } = createTestApp();

      const response = await request(app)
        .get(`/api/v1/sync/runs?limit=${limit}`)
        .set("x-test-admin", "yes");

      expect(response.status).toBe(400);
      expect(response.headers["content-type"]).toContain(
        "application/problem+json",
      );
      expect(service.listRuns).not.toHaveBeenCalled();
    },
  );

  it("answers 500 without leaking when a run breaks the contract", async () => {
    const service = createServiceDouble();
    service.listRuns.mockResolvedValue([
      runRecord({ result: "WEIRD-LEAKED-RESULT" as never }),
    ]);
    const { app } = createTestApp(service);

    const response = await request(app)
      .get("/api/v1/sync/runs")
      .set("x-test-admin", "yes");

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("WEIRD-LEAKED-RESULT");
  });
});

describe("POST /api/v1/sync/run", () => {
  function startedSync(): StartedSync {
    return {
      run: { id: "run-9", kind: "MANUAL", startedAt },
      // The run is still working: the response must not wait for it.
      completion: new Promise<RunRecord>(() => undefined),
    };
  }

  it("requires an administrator and starts nothing without one", async () => {
    const { app, service } = createTestApp();

    const response = await request(app).post("/api/v1/sync/run");

    expect(response.status).toBe(401);
    expect(service.startRun).not.toHaveBeenCalled();
  });

  it("answers 202 with the new run without waiting for it to end", async () => {
    const service = createServiceDouble();
    service.startRun.mockResolvedValue(startedSync());
    const { app } = createTestApp(service);

    const response = await request(app)
      .post("/api/v1/sync/run")
      .set("x-test-admin", "yes");

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      id: "run-9",
      kind: "MANUAL",
      startedAt: "2026-11-27T10:00:00.000Z",
    });
    expect(service.startRun).toHaveBeenCalledWith("MANUAL");
  });

  it("answers 409 as a problem response when a run is already in progress", async () => {
    const service = createServiceDouble();
    service.startRun.mockResolvedValue(null);
    const { app } = createTestApp(service);

    const response = await request(app)
      .post("/api/v1/sync/run")
      .set("x-test-admin", "yes");

    expect(response.status).toBe(409);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.body).toMatchObject({ status: 409 });
  });
});
