import { createHash, randomBytes } from "node:crypto";

import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { customerData, userData } from "../../tests/support/data-factories.js";
import {
  startTestDatabase,
  type TestDatabase,
} from "../../tests/support/test-database.js";
import { createTestEnvironment } from "../../tests/support/test-environment.js";
import type { ErpSyncService } from "../modules/erp-sync/erp-sync.service.js";
import { createApp } from "./create-app.js";

let testDatabase: TestDatabase;
let app: ReturnType<typeof createApp>;
let token: string;

beforeAll(async () => {
  testDatabase = await startTestDatabase();
});

afterAll(async () => {
  await testDatabase?.stop();
});

beforeEach(async () => {
  const { database } = testDatabase;
  await database.$executeRawUnsafe(
    'TRUNCATE TABLE "users", "customers" CASCADE',
  );
  const admin = await database.user.create({
    data: userData({ role: "ADMIN" as const }),
  });
  token = randomBytes(32).toString("base64url");
  await database.session.create({
    data: {
      userId: admin.id,
      tokenDigest: createHash("sha256").update(token).digest("hex"),
      lastUsedAt: new Date(),
    },
  });
  app = createApp({
    database,
    environment: createTestEnvironment({
      DATABASE_URL: testDatabase.databaseUrl,
    }),
    // The ERP service is an external boundary and is never called here.
    erpSyncService: { startRun: vi.fn() } as unknown as ErpSyncService,
  });
});

function createCustomer(erpSellerName: string) {
  return testDatabase.database.customer.create({
    data: customerData({ erpSellerName }),
  });
}

function listNames() {
  return request(app)
    .get("/api/v1/users/erp-seller-names")
    .set("Authorization", `Bearer ${token}`);
}

describe("synchronized ERP seller names with PostgreSQL", () => {
  it("registers a seller with a listed name that ends with a space, unchanged", async () => {
    const erpSellerName = "Ana Souza ";
    await createCustomer(erpSellerName);
    const listed = await listNames();
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([erpSellerName]);

    const response = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Ana Souza",
        email: "ana@distrilux.com.br",
        role: "SELLER",
        erpSellerName,
      });

    expect(response.status).toBe(201);
    expect(response.body.user.erpSellerName).toBe(erpSellerName);
    const stored = await testDatabase.database.user.findUniqueOrThrow({
      where: { email: "ana@distrilux.com.br" },
    });
    expect(stored.erpSellerName).toBe(erpSellerName);
  });

  it("does not offer a name that has only spaces", async () => {
    await createCustomer("   ");
    await createCustomer("Bruno Reis");

    const response = await listNames();

    expect(response.status).toBe(200);
    expect(response.body).toEqual(["Bruno Reis"]);
  });
});
