import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  customerData,
  orderData,
  productData,
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

async function createOwners() {
  const { database } = testDatabase;
  const seller = await database.user.create({
    data: userData({ role: "SELLER" as const }),
  });
  const customer = await database.customer.create({
    data: customerData({ sellerId: seller.id }),
  });
  return { sellerId: seller.id, customerId: customer.id };
}

describe("order states", () => {
  it("accepts each of the 8 states", async () => {
    const { database } = testDatabase;
    const owners = await createOwners();
    for (const status of [
      "DRAFT",
      "SENDING",
      "SENT_TO_ERP",
      "SEND_ERROR",
      "CREDIT_BLOCKED",
      "AWAITING_FINANCE",
      "APPROVED",
      "REJECTED",
    ] as const) {
      const created = await database.order.create({
        data: orderData({ ...owners, status }),
      });
      expect(created.status).toBe(status);
    }
  });

  it("rejects a state outside the list", async () => {
    const { database } = testDatabase;
    const owners = await createOwners();
    await expect(
      database.order.create({
        data: orderData({ ...owners, status: "UNKNOWN" as never }),
      }),
    ).rejects.toThrow();
  });
});

describe("order items", () => {
  it("returns every item of an order with its cent values", async () => {
    const { database } = testDatabase;
    const owners = await createOwners();
    const first = await database.product.create({ data: productData() });
    const second = await database.product.create({ data: productData() });
    const order = await database.order.create({
      data: orderData({ ...owners }),
    });
    await database.orderItem.createMany({
      data: [
        {
          orderId: order.id,
          productId: first.id,
          quantity: 2,
          unitPriceCents: 1050,
          subtotalCents: 2100,
        },
        {
          orderId: order.id,
          productId: second.id,
          quantity: 1,
          unitPriceCents: 8400,
          subtotalCents: 8400,
        },
      ],
    });
    const found = await database.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });
    expect(found.items).toHaveLength(2);
    expect(found.items.map((item) => item.subtotalCents).sort()).toEqual([
      2100, 8400,
    ]);
  });

  it("rejects an item of a product that does not exist", async () => {
    const { database } = testDatabase;
    const owners = await createOwners();
    const order = await database.order.create({
      data: orderData({ ...owners }),
    });
    await expect(
      database.orderItem.create({
        data: {
          orderId: order.id,
          productId: randomUUID(),
          quantity: 1,
          unitPriceCents: 100,
          subtotalCents: 100,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("order identity and ownership", () => {
  it("rejects a second order with the same send key", async () => {
    const { database } = testDatabase;
    const owners = await createOwners();
    const data = orderData({ ...owners });
    await database.order.create({ data });
    await expect(database.order.create({ data })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("rejects an order for a customer that does not exist", async () => {
    const { database } = testDatabase;
    const owners = await createOwners();
    await expect(
      database.order.create({
        data: orderData({ ...owners, customerId: randomUUID() }),
      }),
    ).rejects.toThrow();
  });
});
