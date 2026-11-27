import "dotenv/config";

import { createServer } from "node:http";

import {
  createDefaultErpSyncService,
  createErpSyncRuntime,
} from "./app/erp-sync-runtime.js";
import { createApp } from "./app/create-app.js";
import { env } from "./shared/config/env.js";
import { createDatabase } from "./shared/database/create-database.js";
import { createLogger } from "./shared/logging/logger.js";

const database = createDatabase();
const logger = createLogger(env);
// One service for the routes and the scheduler, so only one run happens at a time.
const erpSyncService = createDefaultErpSyncService({
  database,
  environment: env,
  logger,
});
const erpSyncRuntime = createErpSyncRuntime({
  enabled: env.ERP_SYNC_ENABLED,
  service: erpSyncService,
  logger,
});
const app = createApp({ database, environment: env, erpSyncService });
const server = createServer(app);

server.listen(env.SERVER_PORT, env.SERVER_HOST, () => {
  logger.info(
    { host: env.SERVER_HOST, port: env.SERVER_PORT },
    "Server listening",
  );
  void erpSyncRuntime.start();
});

async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "Graceful shutdown started");
  // Stop scheduling first, then give a run in progress a bounded time to end.
  await erpSyncRuntime.stop();
  server.close(async (error) => {
    await database.$disconnect();
    if (error) {
      logger.error({ err: error }, "Server shutdown failed");
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));
