import { openApiRegistry } from "../../shared/http/openapi.js";
import { problemContent } from "../../shared/http/problem-openapi.js";
import {
  startedSyncRunSchema,
  syncRunListSchema,
  syncRunSchema,
  syncRunsQuerySchema,
  syncStatusSchema,
} from "./erp-sync.schemas.js";

// The schemes are registered by the owner of authentication; only their names
// are referenced here.
const administratorSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];
const administratorErrors = {
  401: {
    description: "Administrator credentials are required",
    content: problemContent,
  },
  403: {
    description: "Administrator role is required",
    content: problemContent,
  },
};

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
  security: administratorSecurity,
  responses: {
    ...administratorErrors,
    200: {
      description: "Runs, newest first",
      content: { "application/json": { schema: syncRunListSchema } },
    },
    400: { description: "Invalid limit" },
  },
});

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/sync/run",
  tags: ["ERP Sync"],
  summary: "Start a synchronization now (administrators only)",
  security: administratorSecurity,
  responses: {
    ...administratorErrors,
    202: {
      description: "Run started; read its outcome from the run list",
      content: { "application/json": { schema: startedSyncRunSchema } },
    },
    409: { description: "A synchronization is already in progress" },
  },
});
