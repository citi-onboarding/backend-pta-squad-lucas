import cron from "node-cron";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ErpSyncService } from "../modules/erp-sync/erp-sync.service.js";
import type {
  CronHandle,
  ScheduleFunction,
} from "../modules/erp-sync/erp-sync.scheduler.js";
import {
  createErpSyncRuntime,
  createNodeCronSchedule,
  unrefSleep,
} from "./erp-sync-runtime.js";

afterEach(() => {
  vi.useRealTimers();
  for (const task of cron.getTasks().values()) {
    void task.destroy();
  }
});

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("unrefSleep", () => {
  it("resolves only after the requested time", async () => {
    vi.useFakeTimers();
    let done = false;

    const sleeping = unrefSleep(10_000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;

    expect(done).toBe(true);
  });

  it("does not keep the process alive while it waits", () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, "setTimeout");

    void unrefSleep(10_000);

    expect(timerSpy).toHaveBeenCalledTimes(1);
    const timer = timerSpy.mock.results[0]?.value as { hasRef(): boolean };
    expect(timer.hasRef()).toBe(false);
  });
});

describe("createNodeCronSchedule", () => {
  it("registers a task with the given expression that runs the callback", async () => {
    const callback = vi.fn();

    const handle = createNodeCronSchedule()("*/30 * * * *", callback);

    const tasks = [...cron.getTasks().values()];
    const task = tasks.find(
      (candidate) => candidate.getPattern() === "*/30 * * * *",
    );
    expect(task).toBeDefined();
    await task?.execute();
    expect(callback).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("removes the task when it is stopped", async () => {
    const handle = createNodeCronSchedule()("*/30 * * * *", () => undefined);
    expect(cron.getTasks().size).toBe(1);

    handle.stop();
    await flush();

    expect(cron.getTasks().size).toBe(0);
  });
});

function setup(options: { enabled?: boolean } = {}) {
  const order: string[] = [];
  const handle: CronHandle = { stop: vi.fn(() => order.push("handle.stop")) };
  const registrations: { expression: string; callback: () => void }[] = [];
  const schedule: ScheduleFunction = (expression, callback) => {
    order.push("schedule");
    registrations.push({ expression, callback });
    return handle;
  };
  const service = {
    recoverInterruptedRuns: vi.fn(() => {
      order.push("recover");
      return Promise.resolve(0);
    }),
    startRun: vi.fn<ErpSyncService["startRun"]>(() => Promise.resolve(null)),
    waitForIdle: vi.fn(() => {
      order.push("waitForIdle");
      return Promise.resolve();
    }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sleep = vi.fn<(milliseconds: number) => Promise<void>>(
    () => new Promise<void>(() => undefined),
  );
  const runtime = createErpSyncRuntime({
    enabled: options.enabled ?? true,
    service: service as unknown as ErpSyncService,
    logger,
    schedule,
    sleep,
  });
  return { runtime, order, registrations, handle, service, logger, sleep };
}

describe("createErpSyncRuntime", () => {
  it("closes interrupted runs before it schedules anything", async () => {
    const { runtime, order } = setup();

    await runtime.start();

    expect(order).toEqual(["recover", "schedule"]);
  });

  it("schedules a run every 30 minutes that starts an automatic synchronization", async () => {
    const { runtime, registrations, service } = setup();
    await runtime.start();

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.expression).toBe("*/30 * * * *");
    registrations[0]?.callback();
    await flush();

    expect(service.startRun).toHaveBeenCalledWith("AUTOMATIC");
  });

  it("still closes interrupted runs but schedules nothing when synchronization is disabled", async () => {
    const { runtime, order, registrations } = setup({ enabled: false });

    await runtime.start();

    expect(order).toEqual(["recover"]);
    expect(registrations).toHaveLength(0);
  });

  it("keeps starting when closing interrupted runs fails, without logging the error message", async () => {
    const { runtime, registrations, service, logger } = setup();
    service.recoverInterruptedRuns.mockRejectedValueOnce(
      new Error("contains Padaria Reservada Ltda"),
    );

    await expect(runtime.start()).resolves.toBeUndefined();

    expect(registrations).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "Padaria Reservada",
    );
  });

  it("stops the schedule, waits for the run in progress, and gives up after 10 seconds", async () => {
    const { runtime, order, sleep } = setup();
    await runtime.start();
    sleep.mockResolvedValue(undefined);

    await runtime.stop();

    expect(order.slice(-2)).toEqual(["handle.stop", "waitForIdle"]);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });
});
