import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CUSTOMERS,
  createFakeErp,
  erpCustomer,
  erpProduct,
  erpReceivable,
  required,
  sampleData,
} from "../../../tests/support/fake-erp.js";
import type { ErpData } from "../../../tests/support/fake-erp.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../../tests/support/test-database.js";
import { ErpError } from "../../shared/erp/erp-error.js";
import { PrismaErpSyncRepository } from "./erp-sync.repository.js";
import { createErpSyncService } from "./erp-sync.service.js";
import type { RunRecord, SyncKind } from "./erp-sync.service.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
});

afterAll(async () => {
  await testDatabase.stop();
});

beforeEach(async () => {
  const { database } = testDatabase;
  await database.receivable.deleteMany();
  await database.customer.deleteMany();
  await database.product.deleteMany();
  await database.syncRun.deleteMany();
});

function setup(data: ErpData = sampleData()) {
  const fakeErp = createFakeErp(data);
  const clock = { time: Date.parse("2026-11-27T10:00:00.000Z") };
  const repository = new PrismaErpSyncRepository(testDatabase.database);
  const service = createErpSyncService({
    erp: fakeErp.erp,
    repository,
    now: () => new Date(clock.time),
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
  return { service, repository, erpState: fakeErp.state, clock };
}

async function runToEnd(
  context: Pick<ReturnType<typeof setup>, "service">,
  kind: SyncKind = "AUTOMATIC",
): Promise<RunRecord> {
  const started = await context.service.startRun(kind);
  expect(started).not.toBeNull();
  return required(started).completion;
}

async function counts() {
  const { database } = testDatabase;
  return {
    customers: await database.customer.count(),
    products: await database.product.count(),
    receivables: await database.receivable.count(),
  };
}

describe("erp sync with PostgreSQL", () => {
  it("stores the ERP data and links each receivable to its customer", async () => {
    const context = setup();

    const run = await runToEnd(context);

    expect(run.result).toBe("SUCCESS");
    expect(await counts()).toEqual({
      customers: 3,
      products: 2,
      receivables: 4,
    });
    const { database } = testDatabase;
    const customer = await database.customer.findUniqueOrThrow({
      where: { erpId: "C1" },
    });
    const receivable = await database.receivable.findUniqueOrThrow({
      where: { erpId: 1_001 },
    });
    expect(receivable.customerId).toBe(customer.id);
    expect(receivable.issuedAt).toEqual(new Date("2026-10-05T00:00:00.000Z"));
    expect(receivable.status).toBe("OPEN");
  });

  it("never duplicates rows and leaves unchanged rows untouched when run twice", async () => {
    const context = setup();
    await runToEnd(context);
    const { database } = testDatabase;
    const before = await database.customer.findMany({
      orderBy: { erpId: "asc" },
    });

    const second = await runToEnd(context);

    const after = await database.customer.findMany({
      orderBy: { erpId: "asc" },
    });
    expect(second.recordsChanged).toBe(0);
    expect(await counts()).toEqual({
      customers: 3,
      products: 2,
      receivables: 4,
    });
    expect(after.map((row) => row.updatedAt)).toEqual(
      before.map((row) => row.updatedAt),
    );
  });

  it("updates only the row that changed in the ERP", async () => {
    const context = setup();
    await runToEnd(context);
    const { database } = testDatabase;
    const before = await database.customer.findMany({
      orderBy: { erpId: "asc" },
    });
    context.erpState.data.customers[1] = erpCustomer(2, {
      limiteCreditoCentavos: 2_000_000,
    });

    const second = await runToEnd(context);

    const after = await database.customer.findMany({
      orderBy: { erpId: "asc" },
    });
    expect(second.recordsChanged).toBe(1);
    expect(after[1]?.creditLimitCents).toBe(2_000_000);
    expect(after[0]?.updatedAt).toEqual(before[0]?.updatedAt);
    expect(after[2]?.updatedAt).toEqual(before[2]?.updatedAt);
  });

  it("writes nothing from the run when the database rejects one value", async () => {
    // 3_000_000_000 cents is a valid ERP integer but does not fit a 32-bit column.
    const context = setup({
      customers: [erpCustomer(1)],
      products: [erpProduct(1)],
      receivables: [erpReceivable(1, "C1", { valorCentavos: 3_000_000_000 })],
    });

    const run = await runToEnd(context);

    expect(run.result).toBe("FAILED");
    expect(run.errorDetail).toMatch(/database rejected/i);
    expect(run.errorDetail).not.toContain("3000000000");
    expect(await counts()).toEqual({
      customers: 0,
      products: 0,
      receivables: 0,
    });
  });

  it("keeps the old data when the ERP fails and stores the RATE_LIMITED result", async () => {
    const context = setup();
    await runToEnd(context);
    context.erpState.failures.set(
      CUSTOMERS,
      new ErpError({ kind: "http", status: 429, path: CUSTOMERS, attempts: 5 }),
    );
    context.clock.time = Date.parse("2026-11-27T10:30:00.000Z");

    const run = await runToEnd(context);

    const [latest] = await context.service.listRuns(1);
    expect(run.result).toBe("RATE_LIMITED");
    expect(latest?.result).toBe("RATE_LIMITED");
    expect(await counts()).toEqual({
      customers: 3,
      products: 2,
      receivables: 4,
    });
  });

  it("derives the last successful time and the ERP availability from the runs", async () => {
    const context = setup();
    await runToEnd(context);
    context.erpState.failures.set(
      CUSTOMERS,
      new ErpError({ kind: "network", path: CUSTOMERS, attempts: 5 }),
    );
    context.clock.time = Date.parse("2026-11-27T10:30:00.000Z");
    await runToEnd(context);

    const status = await context.service.getStatus();

    expect(status).toEqual({
      lastSuccessfulSyncAt: new Date("2026-11-27T10:00:00.000Z"),
      running: false,
      erpAvailable: false,
    });
  });

  it("lists runs newest first, honoring the limit, with a run in progress shown as open", async () => {
    const context = setup();
    await runToEnd(context);
    context.clock.time = Date.parse("2026-11-27T10:30:00.000Z");
    await runToEnd(context);
    context.clock.time = Date.parse("2026-11-27T11:00:00.000Z");
    await context.repository.startRun({
      kind: "MANUAL",
      startedAt: new Date(context.clock.time),
    });

    const runs = await context.service.listRuns(2);

    expect(runs.map((run) => run.startedAt.toISOString())).toEqual([
      "2026-11-27T11:00:00.000Z",
      "2026-11-27T10:30:00.000Z",
    ]);
    expect(runs[0]).toMatchObject({
      kind: "MANUAL",
      finishedAt: null,
      result: null,
    });
  });

  it("closes a run that never ended at startup so it cannot block the next one", async () => {
    const context = setup();
    await context.repository.startRun({
      kind: "AUTOMATIC",
      startedAt: new Date("2026-11-27T09:30:00.000Z"),
    });

    const closed = await context.service.recoverInterruptedRuns();
    const [run] = await context.service.listRuns(1);
    const next = await runToEnd(context);

    expect(closed).toBe(1);
    expect(run).toMatchObject({ result: "FAILED" });
    expect(run?.errorDetail).toMatch(/interrupted/i);
    expect(next.result).toBe("SUCCESS");
  });
});
