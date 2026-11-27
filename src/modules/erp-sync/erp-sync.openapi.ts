import { openApiRegistry } from "../../shared/http/openapi.js";
import {
  startedSyncRunSchema,
  syncRunListSchema,
  syncRunSchema,
  syncRunsQuerySchema,
  syncStatusSchema,
} from "./erp-sync.schemas.js";

openApiRegistry.register("SyncStatus", syncStatusSchema);
openApiRegistry.register("SyncRun", syncRunSchema);
openApiRegistry.register("StartedSyncRun", startedSyncRunSchema);

openApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/sync/status",
  tags: ["ERP Sync"],
  summary:
    "When the ERP data was last synchronized and whether the ERP answered",
  responses: {
    200: {
      description: "Synchronization status",
      content: { "application/json": { schema: syncStatusSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/sync/runs",
  tags: ["ERP Sync"],
  summary: "List the latest synchronization runs (administrators only)",
  request: { query: syncRunsQuerySchema },
  responses: {
    200: {
      description: "Runs, newest first",
      content: { "application/json": { schema: syncRunListSchema } },
    },
    400: { description: "Invalid limit" },
    401: { description: "Administrator credentials are required" },
  },
});

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/sync/run",
  tags: ["ERP Sync"],
  summary: "Start a synchronization now (administrators only)",
  responses: {
    202: {
      description: "Run started; read its outcome from the run list",
      content: { "application/json": { schema: startedSyncRunSchema } },
    },
    401: { description: "Administrator credentials are required" },
    409: { description: "A synchronization is already in progress" },
  },
});
