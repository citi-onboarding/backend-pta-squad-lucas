import { Router } from "express";
import type { RequestHandler, Router as ExpressRouter } from "express";
import type { ZodType } from "zod";

import { HttpProblem } from "../../shared/http/problem.js";
import {
  startedSyncRunSchema,
  syncRunListSchema,
  syncRunsQuerySchema,
  syncStatusSchema,
} from "./erp-sync.schemas.js";
import type { ErpSyncService, RunRecord } from "./erp-sync.service.js";
import "./erp-sync.openapi.js";

export interface ErpSyncRouterOptions {
  service: ErpSyncService;
  adminGuard: RequestHandler;
}

// A response that breaks its own contract is a server bug: answer 500 and leak
// nothing, instead of the 400 a ZodError would become.
function serialize<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpProblem(
      500,
      "Internal Server Error",
      "An unexpected error occurred.",
    );
  }
  return parsed.data;
}

function serializeRun(run: RunRecord) {
  return {
    id: run.id,
    kind: run.kind,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    result: run.result,
    recordsRead: run.recordsRead,
    recordsChanged: run.recordsChanged,
    errorDetail: run.errorDetail,
  };
}

export function createErpSyncRouter(
  options: ErpSyncRouterOptions,
): ExpressRouter {
  const { service, adminGuard } = options;
  const router = Router();

  router.get("/status", async (_request, response) => {
    const status = await service.getStatus();
    response.json(
      serialize(syncStatusSchema, {
        lastSuccessfulSyncAt:
          status.lastSuccessfulSyncAt?.toISOString() ?? null,
        running: status.running,
        erpAvailable: status.erpAvailable,
      }),
    );
  });

  router.get("/runs", adminGuard, async (request, response) => {
    const { limit } = syncRunsQuerySchema.parse(request.query);
    const runs = await service.listRuns(limit);
    response.json(serialize(syncRunListSchema, runs.map(serializeRun)));
  });

  router.post("/run", adminGuard, async (_request, response) => {
    const started = await service.startRun("MANUAL");
    if (started === null) {
      throw new HttpProblem(
        409,
        "Conflict",
        "A synchronization is already in progress.",
      );
    }
    // The run continues in the background; its outcome is read from the run list.
    response.status(202).json(
      serialize(startedSyncRunSchema, {
        id: started.run.id,
        kind: started.run.kind,
        startedAt: started.run.startedAt.toISOString(),
      }),
    );
  });

  return router;
}
