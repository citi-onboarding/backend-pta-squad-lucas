import type { ErpSyncService, SyncLogger } from "./erp-sync.service.js";

export interface CronHandle {
  stop(): void;
}

export type ScheduleFunction = (
  expression: string,
  callback: () => void,
) => CronHandle;

export interface ErpSyncSchedulerOptions {
  service: ErpSyncService;
  schedule: ScheduleFunction;
  enabled: boolean;
  logger: SyncLogger;
  sleep: (milliseconds: number) => Promise<void>;
}

export interface ErpSyncScheduler {
  start(): void;
  stop(): Promise<void>;
}

const EVERY_30_MINUTES = "*/30 * * * *";
// The ERP client cannot be cancelled, so shutdown waits for a run only this long.
const SHUTDOWN_GRACE_MS = 10_000;

export function createErpSyncScheduler(
  options: ErpSyncSchedulerOptions,
): ErpSyncScheduler {
  const { service, schedule, enabled, logger, sleep } = options;
  let handle: CronHandle | undefined;

  async function tick(): Promise<void> {
    try {
      const started = await service.startRun("AUTOMATIC");
      if (started === null) {
        logger.info(
          { reason: "previous-run-in-progress" },
          "Skipping scheduled ERP synchronization",
        );
      }
    } catch (error) {
      // Only the error name: its message could quote data.
      logger.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Could not start the scheduled ERP synchronization",
      );
    }
  }

  return {
    start() {
      if (!enabled) {
        return;
      }
      handle = schedule(EVERY_30_MINUTES, () => {
        void tick();
      });
    },
    async stop() {
      handle?.stop();
      handle = undefined;
      await Promise.race([service.waitForIdle(), sleep(SHUTDOWN_GRACE_MS)]);
    },
  };
}
