let counter = 0;

function next(): number {
  counter += 1;
  return counter;
}

export function userData<T extends object = object>(overrides: T = {} as T) {
  const n = next();
  return {
    name: `User ${String(n)}`,
    email: `user-${String(n)}@example.test`,
    passwordHash: "not-a-real-hash",
    role: "MANAGER" as const,
    ...overrides,
  };
}

export function customerData<T extends object = object>(
  overrides: T = {} as T,
) {
  const n = next();
  return {
    erpId: `C${String(n).padStart(4, "0")}`,
    name: `Customer ${String(n)}`,
    cnpj: String(n).padStart(14, "0"),
    city: "Recife",
    state: "PE",
    segment: "Test",
    status: "ACTIVE" as const,
    creditLimitCents: 5_000_000,
    ...overrides,
  };
}

export function productData<T extends object = object>(overrides: T = {} as T) {
  const n = next();
  return {
    erpId: `P${String(n).padStart(5, "0")}`,
    description: `Product ${String(n)}`,
    category: "Test",
    unit: "UN",
    listPriceCents: 1050,
    active: true,
    ...overrides,
  };
}

export function receivableData<T extends object = object>(
  overrides: T = {} as T,
) {
  const n = next();
  return {
    erpId: 900_000 + n,
    erpOrderNumber: 40_000 + n,
    installment: "1/1",
    amountCents: 235_878,
    issuedAt: new Date("2026-10-05"),
    dueDate: new Date("2026-11-04"),
    status: "OPEN" as const,
    ...overrides,
  };
}

export function orderData<T extends object = object>(overrides: T = {} as T) {
  const n = next();
  return {
    status: "DRAFT" as const,
    totalCents: 10_500,
    sendKey: `send-key-${String(n)}`,
    ...overrides,
  };
}

export function contractData<T extends object = object>(
  overrides: T = {} as T,
) {
  const n = next();
  return {
    number: `CF-2026-${String(n).padStart(3, "0")}`,
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
    noticeDays: 30,
    autoRenew: true,
    paymentTerms: "30 days",
    minVolumeCents: 3_500_000,
    hasAmendment: false,
    ...overrides,
  };
}

export function historicalItemData<T extends object = object>(
  overrides: T = {} as T,
) {
  const n = next();
  return {
    orderNumber: 40_000 + n,
    productCode: `P${String(n).padStart(5, "0")}`,
    date: new Date("2025-01-10"),
    customerCode: "C0072",
    sellerName: "Marcos Viana",
    quantity: 3,
    unitPriceCents: 1050,
    totalCents: 3150,
    status: "INVOICED" as const,
    ...overrides,
  };
}

export function historicalReceivableData<T extends object = object>(
  overrides: T = {} as T,
) {
  const n = next();
  return {
    titleId: 893_950 + n,
    customerCode: "C0038",
    orderNumber: 40_486,
    installment: "1/2",
    amountCents: 235_878,
    issuedAt: new Date("2025-01-02"),
    dueDate: new Date("2025-02-01"),
    status: "PAID" as const,
    ...overrides,
  };
}

export function loadIssueData<T extends object = object>(
  overrides: T = {} as T,
) {
  const n = next();
  return {
    runId: "run-1",
    sourceFile: `source-${String(n)}.xlsx`,
    rowNumber: 10,
    problemType: "MISSING_PRODUCT_CODE",
    ...overrides,
  };
}
