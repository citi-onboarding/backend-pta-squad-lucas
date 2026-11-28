import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startTestDatabase,
  type TestDatabase,
} from "../../../tests/support/test-database.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
});

afterAll(async () => {
  await testDatabase.stop();
});

let counter = 0;

function churnFeatureData<T extends object = object>(overrides: T = {} as T) {
  counter += 1;
  return {
    customerCode: `C${String(counter).padStart(4, "0")}`,
    month: "2025-03",
    ordersLast3m: 3,
    revenueLast3mCents: 450_000,
    revenuePrev3mCents: 380_000,
    daysSinceLastOrder: 14,
    overdueReceivables: 1,
    segment: "Varejo",
    churned90d: false,
    ...overrides,
  };
}

describe("churn features storage", () => {
  it("stores monthly features in cents and allows nullable recency and label", async () => {
    const { database } = testDatabase;
    const preAcquisition = await database.churnFeature.create({
      data: churnFeatureData({
        ordersLast3m: 0,
        revenueLast3mCents: 0,
        revenuePrev3mCents: 0,
        daysSinceLastOrder: null,
        overdueReceivables: 0,
        churned90d: null,
      }),
    });

    const found = await database.churnFeature.findUniqueOrThrow({
      where: { id: preAcquisition.id },
    });

    expect(found.daysSinceLastOrder).toBeNull();
    expect(found.churned90d).toBeNull();
    expect(found.revenueLast3mCents).toBe(0);
    expect(found.segment).toBe("Varejo");
  });

  it("rejects a duplicate (customerCode, month) record", async () => {
    const { database } = testDatabase;
    const first = churnFeatureData();
    await database.churnFeature.create({ data: first });

    await expect(
      database.churnFeature.create({
        data: { ...first, ordersLast3m: 9 },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("updates in place without duplicating when upserted twice", async () => {
    const { database } = testDatabase;
    const initial = churnFeatureData({ churned90d: false });

    await database.churnFeature.upsert({
      where: {
        customerCode_month: {
          customerCode: initial.customerCode,
          month: initial.month,
        },
      },
      create: initial,
      update: initial,
    });

    await database.churnFeature.upsert({
      where: {
        customerCode_month: {
          customerCode: initial.customerCode,
          month: initial.month,
        },
      },
      create: { ...initial, churned90d: true, overdueReceivables: 2 },
      update: { churned90d: true, overdueReceivables: 2 },
    });

    const stored = await database.churnFeature.findMany({
      where: { customerCode: initial.customerCode, month: initial.month },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.churned90d).toBe(true);
    expect(stored[0]?.overdueReceivables).toBe(2);
  });
});
