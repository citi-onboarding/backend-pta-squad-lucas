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
        contentKey_occurrence: {
          contentKey: data.contentKey,
          occurrence: data.occurrence,
        },
      },
      create: data,
      update: data,
    });
  }

  async function countByKey(contentKey: string) {
    return testDatabase.database.historicalOrderItem.count({
      where: { contentKey },
    });
  }

  it("does not duplicate when the same data is loaded twice", async () => {
    const data = historicalItemData({ productCode: "P00001" });
    await loadItem(data);
    await loadItem(data);
    expect(await countByKey(data.contentKey)).toBe(1);
  });

  it("does not duplicate an item without product code", async () => {
    const data = historicalItemData();
    await loadItem(data);
    await loadItem(data);
    expect(await countByKey(data.contentKey)).toBe(1);
    const found =
      await testDatabase.database.historicalOrderItem.findFirstOrThrow({
        where: { contentKey: data.contentKey },
      });
    expect(found.productCode).toBeNull();
  });

  it("keeps two fully identical rows as separate items", async () => {
    const first = historicalItemData();
    await loadItem(first);
    await loadItem({ ...first, occurrence: 2 });
    expect(await countByKey(first.contentKey)).toBe(2);
  });

  it("stores the total in cents", async () => {
    const data = historicalItemData({
      quantity: 3,
      unitPriceCents: 1050,
      totalCents: 3150,
    });
    await loadItem(data);
    const found =
      await testDatabase.database.historicalOrderItem.findFirstOrThrow({
        where: { contentKey: data.contentKey },
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
  it("keeps a title and its reversal", async () => {
    const { database } = testDatabase;
    const original = historicalReceivableData({ status: "PAID" as const });
    await database.historicalReceivable.create({ data: original });
    await database.historicalReceivable.create({
      data: {
        ...original,
        amountCents: -original.amountCents,
        status: "REVERSED" as const,
      },
    });
    const found = await database.historicalReceivable.findMany({
      where: { titleId: original.titleId },
    });
    expect(found.map((title) => title.status).sort()).toEqual([
      "PAID",
      "REVERSED",
    ]);
  });

  it("does not duplicate the same title with the same status", async () => {
    const { database } = testDatabase;
    const data = historicalReceivableData();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await database.historicalReceivable.upsert({
        where: {
          titleId_status: { titleId: data.titleId, status: data.status },
        },
        create: data,
        update: data,
      });
    }
    expect(
      await database.historicalReceivable.count({
        where: { titleId: data.titleId },
      }),
    ).toBe(1);
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
