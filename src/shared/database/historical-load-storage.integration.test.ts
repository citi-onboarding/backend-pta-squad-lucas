import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  historicalItemData,
  historicalReceivableData,
  loadIssueData,
} from "../../../tests/support/data-factories.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../../tests/support/test-database.js";
import type { Prisma } from "./generated/client.js";

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
});

afterAll(async () => {
  await testDatabase.stop();
});

describe("historical order items", () => {
  async function loadItem(data: ReturnType<typeof historicalItemData>) {
    await testDatabase.database.historicalOrderItem.upsert({
      where: {
        orderNumber_productCode: {
          orderNumber: data.orderNumber,
          productCode: data.productCode,
        },
      },
      create: data,
      update: data,
    });
  }

  async function countByOrder(orderNumber: number) {
    return testDatabase.database.historicalOrderItem.count({
      where: { orderNumber },
    });
  }

  it("does not duplicate when the same data is loaded twice", async () => {
    const data = historicalItemData();
    await loadItem(data);
    await loadItem(data);
    expect(await countByOrder(data.orderNumber)).toBe(1);
  });

  it("rejects an item without product code", async () => {
    await expect(
      testDatabase.database.historicalOrderItem.create({
        data: historicalItemData({ productCode: undefined as never }),
      }),
    ).rejects.toThrow("Argument `productCode` is missing");
  });

  it("rejects a second item with the same order number and product code", async () => {
    const { database } = testDatabase;
    const first = historicalItemData();
    await database.historicalOrderItem.create({ data: first });
    await expect(
      database.historicalOrderItem.create({ data: { ...first, quantity: 5 } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps different products of the same order", async () => {
    const first = historicalItemData();
    const second = historicalItemData({ orderNumber: first.orderNumber });
    await loadItem(first);
    await loadItem(second);
    expect(await countByOrder(first.orderNumber)).toBe(2);
  });

  it("stores the total in cents", async () => {
    const created = await testDatabase.database.historicalOrderItem.create({
      data: historicalItemData({
        quantity: 3,
        unitPriceCents: 1050,
        totalCents: 3150,
      }),
    });
    const found =
      await testDatabase.database.historicalOrderItem.findUniqueOrThrow({
        where: { id: created.id },
      });
    expect(found.totalCents).toBe(3150);
  });

  it("accepts INVOICED and CANCELLED and rejects any other status", async () => {
    const { database } = testDatabase;
    for (const status of ["INVOICED", "CANCELLED"] as const) {
      const created = await database.historicalOrderItem.create({
        data: historicalItemData({ status }),
      });
      expect(created.status).toBe(status);
    }
    await expect(
      database.historicalOrderItem.create({
        data: historicalItemData({ status: "UNKNOWN" as never }),
      }),
    ).rejects.toThrow();
  });

  it("keeps the corrections applied to an item", async () => {
    const corrections = { customer: "resolved by name" };
    const created = await testDatabase.database.historicalOrderItem.create({
      data: historicalItemData({ corrections }),
    });
    const found =
      await testDatabase.database.historicalOrderItem.findUniqueOrThrow({
        where: { id: created.id },
      });
    expect(found.corrections).toEqual(corrections);
  });
});

describe("historical receivables", () => {
  async function loadReceivable(data: Prisma.HistoricalReceivableCreateInput) {
    await testDatabase.database.historicalReceivable.upsert({
      where: { titleId: data.titleId },
      create: data,
      update: data,
    });
  }

  async function findByTitle(titleId: number) {
    return testDatabase.database.historicalReceivable.findMany({
      where: { titleId },
    });
  }

  it("stores a reversed title as one record", async () => {
    const data = {
      ...historicalReceivableData(),
      status: "REVERSED" as const,
    };
    await loadReceivable(data);
    const found = await findByTitle(data.titleId);
    expect(found.map((title) => title.status)).toEqual(["REVERSED"]);
  });

  it("rejects a second record with the same title id", async () => {
    const { database } = testDatabase;
    const original = historicalReceivableData({ status: "PAID" as const });
    await database.historicalReceivable.create({ data: original });
    await expect(
      database.historicalReceivable.create({
        data: { ...original, status: "REVERSED" as const },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("updates the same record when the status of a title changes", async () => {
    const paid = historicalReceivableData({ status: "PAID" as const });
    await loadReceivable(paid);
    await loadReceivable({ ...paid, status: "REVERSED" as const });
    const found = await findByTitle(paid.titleId);
    expect(found.map((title) => title.status)).toEqual(["REVERSED"]);
  });

  it("allows an open title without payment date and keeps corrections", async () => {
    const { database } = testDatabase;
    const created = await database.historicalReceivable.create({
      data: historicalReceivableData({
        status: "OPEN" as const,
        corrections: { paidAt: "reconciled" },
      }),
    });
    expect(created.paidAt).toBeNull();
    expect(created.corrections).toEqual({ paidAt: "reconciled" });
  });
});

describe("load issues", () => {
  it("allows a whole-row problem without field, original value or resolution", async () => {
    const created = await testDatabase.database.loadIssue.create({
      data: loadIssueData(),
    });
    expect(created.field).toBeNull();
    expect(created.rawValue).toBeNull();
    expect(created.resolution).toBeNull();
  });

  it("does not duplicate the same problem when recorded twice", async () => {
    const { database } = testDatabase;
    const data = loadIssueData();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await database.loadIssue.upsert({
        where: {
          sourceFile_rowNumber_problemType: {
            sourceFile: data.sourceFile,
            rowNumber: data.rowNumber,
            problemType: data.problemType,
          },
        },
        create: data,
        update: { runId: "run-2" },
      });
    }
    expect(
      await database.loadIssue.count({
        where: { sourceFile: data.sourceFile },
      }),
    ).toBe(1);
  });

  it("keeps different problems of the same row", async () => {
    const { database } = testDatabase;
    const first = loadIssueData();
    await database.loadIssue.create({ data: first });
    await database.loadIssue.create({
      data: { ...first, problemType: "INVALID_STATUS" },
    });
    expect(
      await database.loadIssue.count({
        where: { sourceFile: first.sourceFile },
      }),
    ).toBe(2);
  });
});
