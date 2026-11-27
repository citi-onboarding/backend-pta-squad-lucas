import { describe, expect, it, vi } from "vitest";

import { createErpSyncScheduler } from "./erp-sync.scheduler.js";
import type { CronHandle, ScheduleFunction } from "./erp-sync.scheduler.js";
import type {
  ErpSyncService,
  StartedSync,
  SyncLogger,
} from "./erp-sync.service.js";

// Fakes only the external pieces: the cron library, the service boundary used
// by the scheduler, the logger, and the sleep timer.
function setup(options: { enabled?: boolean } = {}) {
  const handle: CronHandle = { stop: vi.fn() };
  const registrations: { expression: string; callback: () => void }[] = [];
  const schedule: ScheduleFunction = (expression, callback) => {
    registrations.push({ expression, callback });
    return handle;
  };
  const service = {
    startRun: vi.fn<ErpSyncService["startRun"]>(),
    waitForIdle: vi.fn<ErpSyncService["waitForIdle"]>(() => Promise.resolve()),
  };
  const logger = {
    info: vi.fn<SyncLogger["info"]>(),
    warn: vi.fn<SyncLogger["warn"]>(),
    error: vi.fn<SyncLogger["error"]>(),
  };
  const sleep = vi.fn<(milliseconds: number) => Promise<void>>(
    () => new Promise<void>(() => undefined),
  );
  const scheduler = createErpSyncScheduler({
    service: service as unknown as ErpSyncService,
    schedule,
    enabled: options.enabled ?? true,
    logger,
    sleep,
  });
  return { scheduler, registrations, handle, service, logger, sleep };
}

function startedRun(): StartedSync {
  return {
    run: {
      id: "run-1",
      kind: "AUTOMATIC",
      startedAt: new Date("2026-11-27T10:00:00.000Z"),
    },
    completion: Promise.resolve({
      id: "run-1",
      kind: "AUTOMATIC",
      startedAt: new Date("2026-11-27T10:00:00.000Z"),
      finishedAt: new Date("2026-11-27T10:00:05.000Z"),
      result: "SUCCESS",
      recordsRead: 0,
      recordsChanged: 0,
      errorDetail: null,
    }),
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("erp sync scheduler", () => {
  it("schedules one job that fires every 30 minutes", () => {
    const { scheduler, registrations } = setup();

    scheduler.start();

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.expression).toBe("*/30 * * * *");
  });

  it("starts an automatic run when the schedule fires", async () => {
    const { scheduler, registrations, service } = setup();
    service.startRun.mockResolvedValue(startedRun());
    scheduler.start();

    registrations[0]?.callback();
    await flush();

    expect(service.startRun).toHaveBeenCalledTimes(1);
    expect(service.startRun).toHaveBeenCalledWith("AUTOMATIC");
  });

  it("skips the tick without error when a run is already in progress", async () => {
    const { scheduler, registrations, service, logger } = setup();
    service.startRun.mockResolvedValue(null);
    scheduler.start();

    registrations[0]?.callback();
    await flush();

    expect(service.startRun).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("survives a failure to start a run and logs no error message", async () => {
    const { scheduler, registrations, service, logger } = setup();
    service.startRun.mockRejectedValue(
      new Error("contains Padaria Reservada Ltda"),
    );
    scheduler.start();

    expect(() => registrations[0]?.callback()).not.toThrow();
    await flush();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "Padaria Reservada",
    );
    service.startRun.mockResolvedValue(startedRun());
    registrations[0]?.callback();
    await flush();
    expect(service.startRun).toHaveBeenCalledTimes(2);
  });

  it("never schedules anything when automatic synchronization is disabled", () => {
    const { scheduler, registrations } = setup({ enabled: false });

    scheduler.start();

    expect(registrations).toHaveLength(0);
  });

  it("stops the job and waits for the run in progress", async () => {
    const { scheduler, handle, service } = setup();
    scheduler.start();
    let finished = false;
    service.waitForIdle.mockImplementation(async () => {
      await flush();
      finished = true;
    });

    await scheduler.stop();

    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(finished).toBe(true);
  });

  it("gives up waiting after 10 seconds so shutdown is bounded", async () => {
    const { scheduler, service, sleep } = setup();
    scheduler.start();
    service.waitForIdle.mockReturnValue(new Promise<void>(() => undefined));
    sleep.mockResolvedValue(undefined);

    await scheduler.stop();

    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it("can be stopped when it never started", async () => {
    const { scheduler, handle } = setup({ enabled: false });

    await expect(scheduler.stop()).resolves.toBeUndefined();
    expect(handle.stop).not.toHaveBeenCalled();
  });
});
