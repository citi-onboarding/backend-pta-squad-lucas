import { schedule } from "node-cron";

import { createErpSyncScheduler } from "../modules/erp-sync/erp-sync.scheduler.js";
import type { ScheduleFunction } from "../modules/erp-sync/erp-sync.scheduler.js";
import { PrismaErpSyncRepository } from "../modules/erp-sync/erp-sync.repository.js";
import { createErpSyncService } from "../modules/erp-sync/erp-sync.service.js";
import type {
  ErpSyncService,
  SyncLogger,
} from "../modules/erp-sync/erp-sync.service.js";
import type { Environment } from "../shared/config/env.js";
import type { Database } from "../shared/database/create-database.js";
import { createErpClient } from "../shared/erp/erp-client.js";

export interface ErpSyncRuntimeOptions {
  enabled: boolean;
  service: ErpSyncService;
  logger: SyncLogger;
  schedule?: ScheduleFunction;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ErpSyncRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// The timer does not keep the process alive: shutdown waits for a run for at most
// 10 seconds, and an idle process must not wait for that timer to leave.
export function unrefSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

export function createNodeCronSchedule(): ScheduleFunction {
  return (expression, callback) => {
    const task = schedule(expression, () => {
      callback();
    });
    return {
      stop: () => {
        void task.destroy();
      },
    };
  };
}

// The one service shared by the routes and the scheduler, so the
// one-run-at-a-time rule holds across both. Creating it never calls the ERP.
export function createDefaultErpSyncService(options: {
  database: Database;
  environment: Environment;
  logger: SyncLogger;
}): ErpSyncService {
  const { database, environment, logger } = options;
  const erp = createErpClient({
    baseUrl: environment.ERP_API_URL,
    apiKey: environment.ERP_API_KEY,
    timeoutMs: environment.ERP_REQUEST_TIMEOUT_MS,
    logger,
  });
  return createErpSyncService({
    erp,
    repository: new PrismaErpSyncRepository(database),
    now: () => new Date(),
    logger,
  });
}

export function createErpSyncRuntime(
  options: ErpSyncRuntimeOptions,
): ErpSyncRuntime {
  const { service, logger } = options;
  const scheduler = createErpSyncScheduler({
    service,
    schedule: options.schedule ?? createNodeCronSchedule(),
    enabled: options.enabled,
    logger,
    sleep: options.sleep ?? unrefSleep,
  });

  return {
    async start() {
      try {
        await service.recoverInterruptedRuns();
      } catch (error) {
        // Only the error name: its message could quote data. Starting goes on,
        // because an open record never blocks a run in this process.
        logger.error(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "Could not close interrupted synchronization runs",
        );
      }
      scheduler.start();
    },
    stop: () => scheduler.stop(),
  };
}
