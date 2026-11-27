import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  contractData,
  customerData,
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

describe("contract terms", () => {
  it("stores the contract with its terms in whole cents", async () => {
    const { database } = testDatabase;
    const customer = await database.customer.create({ data: customerData() });
    const created = await database.contract.create({
      data: contractData({
        customerId: customer.id,
        noticeDays: 15,
        minVolumeCents: 3_500_000,
        file: "contracts/CF-2025-019.pdf",
      }),
    });
    const found = await database.contract.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(found).toMatchObject({
      noticeDays: 15,
      minVolumeCents: 3_500_000,
      file: "contracts/CF-2025-019.pdf",
    });
  });

  it("rejects a contract of a customer that does not exist", async () => {
    const { database } = testDatabase;
    await expect(
      database.contract.create({
        data: contractData({ customerId: randomUUID() }),
      }),
    ).rejects.toThrow();
  });

  it("rejects a second contract with the same number", async () => {
    const { database } = testDatabase;
    const customer = await database.customer.create({ data: customerData() });
    const data = contractData({ customerId: customer.id });
    await database.contract.create({ data });
    await expect(database.contract.create({ data })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("allows a contract without a document path", async () => {
    const { database } = testDatabase;
    const customer = await database.customer.create({ data: customerData() });
    const created = await database.contract.create({
      data: contractData({ customerId: customer.id }),
    });
    expect(created.file).toBeNull();
  });
});

describe("contract situation", () => {
  it("is not stored with the contract", async () => {
    const { database } = testDatabase;
    const customer = await database.customer.create({ data: customerData() });
    const created = await database.contract.create({
      data: contractData({ customerId: customer.id }),
    });
    expect(created).toHaveProperty("endDate");
    expect(created).toHaveProperty("noticeDays");
    expect(created).not.toHaveProperty("status");
    expect(created).not.toHaveProperty("situation");
  });
});
