import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  customerData,
  productData,
  receivableData,
  userData,
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

describe("ERP code uniqueness", () => {
  it("rejects a second product with the same ERP code", async () => {
    const { database } = testDatabase;
    const data = productData();
    await database.product.create({ data });
    await expect(database.product.create({ data })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("rejects a second receivable with the same ERP code", async () => {
    const { database } = testDatabase;
    const customer = await database.customer.create({ data: customerData() });
    const data = receivableData({ customerId: customer.id });
    await database.receivable.create({ data });
    await expect(database.receivable.create({ data })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("updates instead of duplicating when the ERP code already exists", async () => {
    const { database } = testDatabase;
    const data = customerData();
    await database.customer.create({ data });
    await database.customer.upsert({
      where: { erpId: data.erpId },
      create: data,
      update: { name: "New name" },
    });
    const found = await database.customer.findMany({
      where: { erpId: data.erpId },
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("New name");
  });
});

describe("money in integer cents", () => {
  it("keeps the exact credit limit in cents", async () => {
    const { database } = testDatabase;
    const created = await database.customer.create({
      data: customerData({ creditLimitCents: 1234 }),
    });
    const found = await database.customer.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(found.creditLimitCents).toBe(1234);
  });

  it("uses an integer column for every money field", async () => {
    const { database } = testDatabase;
    const columns = await database.$queryRaw<
      { table_name: string; column_name: string; data_type: string }[]
    >`SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND RIGHT(column_name, 6) = '_cents'`;
    expect(columns.length).toBeGreaterThanOrEqual(10);
    expect(columns.filter((column) => column.data_type !== "integer")).toEqual(
      [],
    );
  });
});

describe("customer status", () => {
  it("accepts every defined status", async () => {
    const { database } = testDatabase;
    for (const status of [
      "ACTIVE",
      "BLOCKED",
      "INACTIVE",
      "PROSPECT",
    ] as const) {
      const created = await database.customer.create({
        data: customerData({ status }),
      });
      expect(created.status).toBe(status);
    }
  });

  it("rejects a status outside the list", async () => {
    const { database } = testDatabase;
    await expect(
      database.customer.create({
        data: customerData({ status: "UNKNOWN" as never }),
      }),
    ).rejects.toThrow();
  });
});

describe("seller portfolio", () => {
  it("lists the customer in the portfolio of its seller", async () => {
    const { database } = testDatabase;
    const seller = await database.user.create({
      data: userData({ role: "SELLER" as const }),
    });
    await database.customer.create({
      data: customerData({ sellerId: seller.id }),
    });
    const found = await database.user.findUniqueOrThrow({
      where: { id: seller.id },
      include: { customers: true },
    });
    expect(found.customers).toHaveLength(1);
  });

  it("allows a customer without a seller", async () => {
    const { database } = testDatabase;
    const created = await database.customer.create({ data: customerData() });
    expect(created.sellerId).toBeNull();
  });

  it("rejects a seller that does not exist", async () => {
    const { database } = testDatabase;
    await expect(
      database.customer.create({
        data: customerData({ sellerId: randomUUID() }),
      }),
    ).rejects.toThrow();
  });
});

describe("receivable", () => {
  it("allows an open receivable without payment date", async () => {
    const { database } = testDatabase;
    const customer = await database.customer.create({ data: customerData() });
    const created = await database.receivable.create({
      data: receivableData({
        customerId: customer.id,
        status: "OPEN" as const,
      }),
    });
    expect(created.paidAt).toBeNull();
  });

  it("rejects a receivable of a customer that does not exist", async () => {
    const { database } = testDatabase;
    await expect(
      database.receivable.create({
        data: receivableData({ customerId: randomUUID() }),
      }),
    ).rejects.toThrow();
  });
});

describe("synchronization run", () => {
  it("records a finished run with its counts", async () => {
    const { database } = testDatabase;
    const created = await database.syncRun.create({
      data: {
        kind: "AUTOMATIC",
        startedAt: new Date("2026-11-25T08:00:00Z"),
        finishedAt: new Date("2026-11-25T08:01:00Z"),
        result: "PARTIAL",
        recordsRead: 200,
        recordsChanged: 197,
        errorDetail: "3 customers with invalid CNPJ",
      },
    });
    const found = await database.syncRun.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(found).toMatchObject({
      kind: "AUTOMATIC",
      result: "PARTIAL",
      recordsRead: 200,
      recordsChanged: 197,
      errorDetail: "3 customers with invalid CNPJ",
    });
  });

  it("allows a run that has started but not finished", async () => {
    const { database } = testDatabase;
    const created = await database.syncRun.create({
      data: { kind: "MANUAL", startedAt: new Date() },
    });
    expect(created.finishedAt).toBeNull();
  });
});
