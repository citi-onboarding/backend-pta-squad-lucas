import { describe, expect, it } from "vitest";
import { createErpClient } from "../../shared/erp/erp-client.js";
import { ErpError } from "../../shared/erp/erp-error.js";
import {
  CUSTOMERS,
  PRODUCTS,
  createFakeErp,
  erpCustomer,
  erpProduct,
  erpReceivable,
  required,
  resourceKey,
  sampleData,
} from "../../../tests/support/fake-erp.js";
import type { ErpData } from "../../../tests/support/fake-erp.js";
import { createErpSyncService } from "./erp-sync.service.js";
import type {
  ErpSyncRepository,
  RunCompletion,
  RunRecord,
  SyncKind,
  SyncRunResult,
  SyncSnapshot,
  SyncedCustomer,
  SyncedProduct,
  SyncedReceivable,
} from "./erp-sync.service.js";

// ---------------------------------------------------------------------------
// Fakes for the external dependencies only: the ERP, the database, the clock,
// and the logger. The service under test is always the real one.
// ---------------------------------------------------------------------------

class InMemoryRepository implements ErpSyncRepository {
  runs: RunRecord[] = [];
  customers = new Map<string, SyncedCustomer>();
  products = new Map<string, SyncedProduct>();
  receivables = new Map<number, SyncedReceivable>();
  applied: SyncSnapshot[] = [];
  failNextApply: Error | undefined;
  private sequence = 0;

  startRun(run: { kind: SyncKind; startedAt: Date }): Promise<string> {
    this.sequence += 1;
    const id = `run-${String(this.sequence)}`;
    this.runs.push({
      id,
      kind: run.kind,
      startedAt: run.startedAt,
      finishedAt: null,
      result: null,
      recordsRead: 0,
      recordsChanged: 0,
      errorDetail: null,
    });
    return Promise.resolve(id);
  }

  finishRun(id: string, completion: RunCompletion): Promise<void> {
    const run = this.runs.find((candidate) => candidate.id === id);
    if (run) {
      Object.assign(run, completion);
    }
    return Promise.resolve();
  }

  closeOpenRuns(finishedAt: Date, errorDetail: string): Promise<number> {
    const open = this.runs.filter((run) => run.finishedAt === null);
    for (const run of open) {
      run.finishedAt = finishedAt;
      run.result = "FAILED";
      run.errorDetail = errorDetail;
    }
    return Promise.resolve(open.length);
  }

  listRuns(limit: number): Promise<RunRecord[]> {
    return Promise.resolve(
      [...this.runs]
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit),
    );
  }

  findLastSuccessfulFinishedAt(): Promise<Date | null> {
    const times = this.runs
      .filter((run) => run.result === "SUCCESS" && run.finishedAt)
      .map((run) => required(run.finishedAt).getTime());
    return Promise.resolve(
      times.length === 0 ? null : new Date(Math.max(...times)),
    );
  }

  findLatestFinishedResult(): Promise<SyncRunResult | null> {
    const finished = this.runs.filter((run) => run.finishedAt !== null);
    const latest = finished.at(-1);
    return Promise.resolve(latest?.result ?? null);
  }

  readSnapshot(): Promise<SyncSnapshot> {
    return Promise.resolve({
      customers: [...this.customers.values()],
      products: [...this.products.values()],
      receivables: [...this.receivables.values()],
    });
  }

  applyChanges(changes: SyncSnapshot): Promise<void> {
    if (this.failNextApply) {
      const error = this.failNextApply;
      this.failNextApply = undefined;
      return Promise.reject(error);
    }
    this.applied.push(changes);
    for (const customer of changes.customers) {
      this.customers.set(customer.erpId, customer);
    }
    for (const product of changes.products) {
      this.products.set(product.erpId, product);
    }
    for (const receivable of changes.receivables) {
      this.receivables.set(receivable.erpId, receivable);
    }
    return Promise.resolve();
  }

  storedCounts() {
    return {
      customers: this.customers.size,
      products: this.products.size,
      receivables: this.receivables.size,
    };
  }

  storedCopy() {
    return structuredClone({
      customers: [...this.customers.entries()],
      products: [...this.products.entries()],
      receivables: [...this.receivables.entries()],
    });
  }
}

interface LogEntry {
  level: "info" | "warn" | "error";
  fields: Record<string, unknown>;
  message: string;
}

function setup(data: ErpData = sampleData()) {
  const repository = new InMemoryRepository();
  const fakeErp = createFakeErp(data);
  const logs: LogEntry[] = [];
  const clock = { time: Date.parse("2026-11-27T10:00:00.000Z") };
  const logger = {
    info: (fields: Record<string, unknown>, message: string) =>
      logs.push({ level: "info", fields, message }),
    warn: (fields: Record<string, unknown>, message: string) =>
      logs.push({ level: "warn", fields, message }),
    error: (fields: Record<string, unknown>, message: string) =>
      logs.push({ level: "error", fields, message }),
  };
  const service = createErpSyncService({
    erp: fakeErp.erp,
    repository,
    now: () => new Date(clock.time),
    logger,
  });
  return { service, repository, fakeErp, erpState: fakeErp.state, logs, clock };
}

type Setup = ReturnType<typeof setup>;

async function runToEnd(
  context: Pick<Setup, "service">,
  kind: SyncKind = "AUTOMATIC",
): Promise<RunRecord> {
  const started = await context.service.startRun(kind);
  expect(started).not.toBeNull();
  return required(started).completion;
}

function networkError(path: string) {
  return new ErpError({ kind: "network", path, attempts: 5 });
}

function rateLimitError(path: string) {
  return new ErpError({ kind: "http", status: 429, path, attempts: 5 });
}

function at(isoTime: string) {
  return Date.parse(isoTime);
}

// ---------------------------------------------------------------------------
// Requirement: Complete copy of ERP customers, products, and receivables
// ---------------------------------------------------------------------------

describe("complete copy of ERP data", () => {
  it("stores everything on a first run and reports the counts", async () => {
    const context = setup({
      customers: [erpCustomer(1), erpCustomer(2), erpCustomer(3)],
      products: [erpProduct(1), erpProduct(2)],
      receivables: [
        erpReceivable(1, "C1"),
        erpReceivable(2, "C1"),
        erpReceivable(3, "C2"),
        erpReceivable(4, "C3"),
      ],
    });

    const run = await runToEnd(context);

    expect(run).toMatchObject({
      kind: "AUTOMATIC",
      result: "SUCCESS",
      recordsRead: 9,
      recordsChanged: 9,
      errorDetail: null,
    });
    expect(run.finishedAt).toEqual(new Date(context.clock.time));
    expect(context.repository.storedCounts()).toEqual({
      customers: 3,
      products: 2,
      receivables: 4,
    });
  });

  it("stores the fields of each resource", async () => {
    const context = setup();

    await runToEnd(context);

    expect(context.repository.customers.get("C1")).toEqual({
      erpId: "C1",
      name: "Mercado Invented 1",
      cnpj: "00000000000001",
      city: "Recife",
      state: "PE",
      segment: "Varejo",
      status: "ACTIVE",
      creditLimitCents: 1_000_000,
      erpSellerName: "Seller Invented",
    });
    expect(context.repository.products.get("P1")).toEqual({
      erpId: "P1",
      description: "Product Invented 1",
      category: "Bebidas",
      unit: "UN",
      listPriceCents: 1_050,
      active: true,
    });
    expect(context.repository.receivables.get(1_001)).toEqual({
      erpId: 1_001,
      customerErpId: "C1",
      erpOrderNumber: 5_001,
      installment: "1/1",
      amountCents: 300_000,
      issuedAt: new Date("2026-10-05T00:00:00.000Z"),
      dueDate: new Date("2026-11-04T00:00:00.000Z"),
      paidAt: null,
      status: "OPEN",
    });
  });

  it("follows every page the ERP announces, asking for 50 records per page", async () => {
    const context = setup({
      customers: [1, 2, 3, 4, 5].map((n) => erpCustomer(n)),
      products: [],
      receivables: [],
    });
    context.erpState.perPage = 2;

    const run = await runToEnd(context);

    const customerCalls = context.erpState.calls.filter((path) =>
      path.startsWith(CUSTOMERS),
    );
    expect(customerCalls).toHaveLength(3);
    for (const [index, path] of customerCalls.entries()) {
      expect(path).toContain(`pagina=${String(index + 1)}`);
      expect(path).toContain("tamanho=50");
    }
    expect(context.repository.customers.size).toBe(5);
    expect(run.recordsRead).toBe(5);
  });

  it.each([
    ["ATIVO", "ACTIVE"],
    ["BLOQUEADO", "BLOCKED"],
    ["INATIVO", "INACTIVE"],
  ])("stores customer status %s as %s", async (erpStatus, expected) => {
    const context = setup({
      customers: [erpCustomer(1, { status: erpStatus })],
      products: [],
      receivables: [],
    });

    await runToEnd(context);

    expect(context.repository.customers.get("C1")?.status).toBe(expected);
  });

  it.each([
    ["PAGO", "PAID"],
    ["EM_ABERTO", "OPEN"],
    ["VENCIDO", "OVERDUE"],
  ])("stores receivable status %s as %s", async (erpStatus, expected) => {
    const context = setup({
      customers: [erpCustomer(1)],
      products: [],
      receivables: [erpReceivable(1, "C1", { status: erpStatus })],
    });

    await runToEnd(context);

    expect(context.repository.receivables.get(1_001)?.status).toBe(expected);
  });

  it("keeps the payment date of a paid receivable and leaves the others empty", async () => {
    const context = setup({
      customers: [erpCustomer(1)],
      products: [],
      receivables: [
        erpReceivable(1, "C1"),
        erpReceivable(2, "C1", { status: "PAGO", pagamento: "2026-11-01" }),
      ],
    });

    await runToEnd(context);

    expect(context.repository.receivables.get(1_001)?.paidAt).toBeNull();
    expect(context.repository.receivables.get(1_002)?.paidAt).toEqual(
      new Date("2026-11-01T00:00:00.000Z"),
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement: Running twice never duplicates data
// ---------------------------------------------------------------------------

describe("running twice never duplicates data", () => {
  it("changes nothing when the ERP data did not change", async () => {
    const context = setup();
    await runToEnd(context);
    const countsAfterFirst = context.repository.storedCounts();
    const copyAfterFirst = context.repository.storedCopy();
    const writesAfterFirst = context.repository.applied.length;

    const second = await runToEnd(context);

    expect(second.result).toBe("SUCCESS");
    expect(second.recordsChanged).toBe(0);
    expect(second.recordsRead).toBe(9);
    expect(context.repository.storedCounts()).toEqual(countsAfterFirst);
    expect(context.repository.storedCopy()).toEqual(copyAfterFirst);
    const writtenSecondTime = context.repository.applied
      .slice(writesAfterFirst)
      .flatMap((changes) => [
        ...changes.customers,
        ...changes.products,
        ...changes.receivables,
      ]);
    expect(writtenSecondTime).toHaveLength(0);
  });

  it("updates only the record that changed in the ERP", async () => {
    const context = setup();
    await runToEnd(context);
    const writesAfterFirst = context.repository.applied.length;
    context.erpState.data.customers[1] = erpCustomer(2, {
      limiteCreditoCentavos: 2_000_000,
    });

    const second = await runToEnd(context);

    expect(second.recordsChanged).toBe(1);
    expect(context.repository.customers.size).toBe(3);
    expect(context.repository.customers.get("C2")?.creditLimitCents).toBe(
      2_000_000,
    );
    const written = context.repository.applied.slice(writesAfterFirst);
    expect(written.flatMap((changes) => changes.customers)).toHaveLength(1);
    expect(written.flatMap((changes) => changes.products)).toHaveLength(0);
    expect(written.flatMap((changes) => changes.receivables)).toHaveLength(0);
  });

  it("turns an open receivable into a paid one without a second row", async () => {
    const context = setup({
      customers: [erpCustomer(1)],
      products: [],
      receivables: [erpReceivable(1, "C1")],
    });
    await runToEnd(context);
    context.erpState.data.receivables[0] = erpReceivable(1, "C1", {
      status: "PAGO",
      pagamento: "2026-11-10",
    });

    const second = await runToEnd(context);

    expect(second.recordsChanged).toBe(1);
    expect(context.repository.receivables.size).toBe(1);
    expect(context.repository.receivables.get(1_001)).toMatchObject({
      status: "PAID",
      paidAt: new Date("2026-11-10T00:00:00.000Z"),
    });
  });
});

describe("records removed from the ERP", () => {
  it("keeps a stored customer the ERP no longer sends", async () => {
    const context = setup();
    await runToEnd(context);
    context.erpState.data.customers = [erpCustomer(1), erpCustomer(2)];

    await runToEnd(context);

    expect(context.repository.customers.has("C3")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Requirement: A failed run keeps the previous copy
// ---------------------------------------------------------------------------

describe("a failed run keeps the previous copy", () => {
  it("ends as FAILED and changes nothing when the ERP is unreachable", async () => {
    const context = setup();
    await runToEnd(context);
    const before = context.repository.storedCopy();
    context.erpState.data.customers[0] = erpCustomer(1, {
      limiteCreditoCentavos: 9_999_999,
    });
    context.erpState.failures.set(CUSTOMERS, networkError(CUSTOMERS));
    context.clock.time = at("2026-11-27T10:30:00.000Z");

    const run = await runToEnd(context);

    expect(run.result).toBe("FAILED");
    expect(run.errorDetail).toContain(CUSTOMERS);
    expect(run.errorDetail).not.toContain("?");
    expect(context.repository.storedCopy()).toEqual(before);
  });

  it("stores no customer when the product read fails", async () => {
    const context = setup();
    context.erpState.failures.set(PRODUCTS, networkError(PRODUCTS));

    const run = await runToEnd(context);

    expect(run.result).toBe("FAILED");
    expect(context.repository.storedCounts()).toEqual({
      customers: 0,
      products: 0,
      receivables: 0,
    });
  });

  it("ends as FAILED when the database rejects the changes, without quoting values", async () => {
    const context = setup();
    context.repository.failNextApply = new Error(
      "Value 3000000000 out of range for customer Mercado Invented 1",
    );

    const run = await runToEnd(context);

    expect(run.result).toBe("FAILED");
    expect(run.errorDetail).toMatch(/database rejected/i);
    expect(run.errorDetail).not.toContain("3000000000");
    expect(run.errorDetail).not.toContain("Mercado Invented");
    expect(context.repository.storedCounts()).toEqual({
      customers: 0,
      products: 0,
      receivables: 0,
    });
  });

  it("recovers on the next run", async () => {
    const context = setup();
    context.erpState.failures.set(CUSTOMERS, networkError(CUSTOMERS));
    const failed = await runToEnd(context);
    context.erpState.failures.clear();
    context.clock.time = at("2026-11-27T10:30:00.000Z");

    const recovered = await runToEnd(context);

    expect(failed.result).toBe("FAILED");
    expect(recovered.result).toBe("SUCCESS");
    expect(context.repository.storedCounts()).toEqual({
      customers: 3,
      products: 2,
      receivables: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement: Rate limit is reported as its own result
// ---------------------------------------------------------------------------

describe("rate limit", () => {
  it("ends as RATE_LIMITED, keeps the data, and says the limit was reached", async () => {
    const context = setup();
    await runToEnd(context);
    const before = context.repository.storedCopy();
    context.erpState.failures.set(CUSTOMERS, rateLimitError(CUSTOMERS));

    const run = await runToEnd(context);

    expect(run.result).toBe("RATE_LIMITED");
    expect(run.errorDetail).toMatch(/rate limit/i);
    expect(context.repository.storedCopy()).toEqual(before);
  });

  describe("with the real ERP client and a fake fetch", () => {
    function setupWithRealClient(options: { rateLimited: number | "always" }) {
      const repository = new InMemoryRepository();
      const data = sampleData();
      const waits: number[] = [];
      let fetchCalls = 0;
      let rateLimitedSoFar = 0;
      const fakeFetch: typeof fetch = (input) => {
        fetchCalls += 1;
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (
          options.rateLimited === "always" ||
          rateLimitedSoFar < options.rateLimited
        ) {
          rateLimitedSoFar += 1;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                type: "about:blank",
                title: "Limite de requisições excedido",
                status: 429,
                detail: "Too many requests.",
                instance: `${url.pathname}${url.search}`,
              }),
              {
                status: 429,
                headers: { "content-type": "application/problem+json" },
              },
            ),
          );
        }
        const key = required(resourceKey[url.pathname]);
        const records = data[key];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              dados: records,
              pagina: 1,
              tamanho: 50,
              total: records.length,
              totalPaginas: 1,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      };
      const erp = createErpClient({
        baseUrl: "https://erp.example.invalid",
        apiKey: "fake-erp-key-must-not-leak",
        timeoutMs: 60_000,
        fetch: fakeFetch,
        sleep: (milliseconds) => {
          waits.push(milliseconds);
          return Promise.resolve();
        },
        now: () => at("2026-11-27T10:00:00.000Z"),
      });
      const service = createErpSyncService({
        erp,
        repository,
        now: () => new Date(at("2026-11-27T10:00:00.000Z")),
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      });
      return { service, repository, waits, fetchCalls: () => fetchCalls };
    }

    it("absorbs a single 429 and still succeeds", async () => {
      const context = setupWithRealClient({ rateLimited: 1 });

      const run = await runToEnd(context);

      expect(run.result).toBe("SUCCESS");
      expect(context.waits).toHaveLength(1);
      expect(context.repository.storedCounts()).toEqual({
        customers: 3,
        products: 2,
        receivables: 4,
      });
    });

    it("ends as RATE_LIMITED when every attempt is answered with 429, without retrying on its own", async () => {
      const context = setupWithRealClient({ rateLimited: "always" });

      const run = await runToEnd(context);

      expect(run.result).toBe("RATE_LIMITED");
      expect(context.fetchCalls()).toBe(5);
      expect(run.errorDetail).toMatch(/rate limit/i);
      expect(run.errorDetail).not.toContain("Too many requests");
      expect(context.repository.storedCounts()).toEqual({
        customers: 0,
        products: 0,
        receivables: 0,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement: Invalid ERP records are rejected one by one
// ---------------------------------------------------------------------------

describe("invalid ERP records", () => {
  it("rejects one customer with an unknown status and stores the others", async () => {
    const context = setup({
      customers: [
        erpCustomer(1),
        erpCustomer(2),
        erpCustomer(3, {
          status: "SUSPENSO",
          razaoSocial: "Padaria Reservada Ltda",
        }),
      ],
      products: [erpProduct(1), erpProduct(2)],
      receivables: [],
    });

    const run = await runToEnd(context);

    expect(run.result).toBe("PARTIAL");
    expect(run.recordsRead).toBe(5);
    expect(run.recordsChanged).toBe(4);
    expect([...context.repository.customers.keys()]).toEqual(["C1", "C2"]);
    expect(run.errorDetail).toContain("customers");
    expect(run.errorDetail).toContain("status");
    expect(run.errorDetail).not.toContain("Padaria Reservada");
    expect(run.errorDetail).not.toContain("SUSPENSO");
  });

  it("rejects a receivable whose customer is not stored", async () => {
    const context = setup({
      customers: [erpCustomer(1)],
      products: [],
      receivables: [erpReceivable(1, "C1"), erpReceivable(2, "C99")],
    });

    const run = await runToEnd(context);

    expect(run.result).toBe("PARTIAL");
    expect([...context.repository.receivables.keys()]).toEqual([1_001]);
    expect(run.errorDetail).toContain("receivables");
    expect(run.errorDetail).toContain("cliente");
    expect(run.errorDetail).not.toContain("C99");
  });

  it("keeps the previous copy of a record that is now rejected", async () => {
    const context = setup({
      customers: [erpCustomer(1)],
      products: [],
      receivables: [],
    });
    await runToEnd(context);
    context.erpState.data.customers = [
      erpCustomer(1, { status: "SUSPENSO", limiteCreditoCentavos: 5 }),
    ];

    const second = await runToEnd(context);

    expect(second.result).toBe("PARTIAL");
    expect(context.repository.customers.get("C1")).toMatchObject({
      status: "ACTIVE",
      creditLimitCents: 1_000_000,
    });
  });

  it("fails the whole run when a list is not a list of records at all", async () => {
    const context = setup();
    context.erpState.overrides.set(CUSTOMERS, {
      dados: "not-a-list",
      pagina: 1,
      tamanho: 50,
      total: 0,
      totalPaginas: 1,
    });

    const run = await runToEnd(context);

    expect(run.result).toBe("FAILED");
    expect(run.errorDetail).toContain(CUSTOMERS);
    expect(context.repository.storedCounts()).toEqual({
      customers: 0,
      products: 0,
      receivables: 0,
    });
  });

  it("keeps record values out of the logs and logs the resource and field names", async () => {
    const context = setup({
      customers: [
        erpCustomer(1, {
          status: "SUSPENSO",
          razaoSocial: "Padaria Reservada Ltda",
        }),
      ],
      products: [],
      receivables: [],
    });

    await runToEnd(context);

    const serialized = JSON.stringify(context.logs);
    expect(serialized).not.toContain("Padaria Reservada");
    expect(serialized).not.toContain("SUSPENSO");
    const warning = context.logs.find((entry) => entry.level === "warn");
    expect(warning).toBeDefined();
    expect(JSON.stringify(warning?.fields)).toContain("customers");
    expect(JSON.stringify(warning?.fields)).toContain("status");
  });
});

// ---------------------------------------------------------------------------
// Requirement: Every run is recorded
// ---------------------------------------------------------------------------

describe("run records", () => {
  it("records a run when it starts and completes it when it ends", async () => {
    const context = setup();
    let release: () => void = () => undefined;
    context.erpState.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const started = await context.service.startRun("MANUAL");

    expect(started).not.toBeNull();
    expect(context.repository.runs).toHaveLength(1);
    expect(context.repository.runs[0]).toMatchObject({
      kind: "MANUAL",
      startedAt: new Date(context.clock.time),
      finishedAt: null,
      result: null,
    });
    release();
    const finished = await required(started).completion;
    expect(finished.result).toBe("SUCCESS");
    expect(context.repository.runs[0]).toMatchObject({
      finishedAt: new Date(context.clock.time),
      result: "SUCCESS",
    });
  });

  it("returns the identifier, kind, and start time of the new run", async () => {
    const context = setup();

    const started = await context.service.startRun("MANUAL");

    expect(started?.run).toEqual({
      id: context.repository.runs[0]?.id,
      kind: "MANUAL",
      startedAt: new Date(context.clock.time),
    });
    await started?.completion;
  });

  it("records a failed run with a safe detail and no error on success", async () => {
    const context = setup();
    const success = await runToEnd(context);
    context.erpState.failures.set(PRODUCTS, networkError(PRODUCTS));

    const failure = await runToEnd(context);

    expect(success.errorDetail).toBeNull();
    expect(failure).toMatchObject({ result: "FAILED", recordsChanged: 0 });
    expect(failure.errorDetail).toContain(PRODUCTS);
  });

  it("logs the end of a run with its result and counts", async () => {
    const context = setup();

    await runToEnd(context);

    const ended = context.logs.find(
      (entry) => entry.level === "info" && entry.fields.result === "SUCCESS",
    );
    expect(ended?.fields).toMatchObject({
      kind: "AUTOMATIC",
      recordsRead: 9,
      recordsChanged: 9,
    });
  });

  it("lists the newest runs first and honors the limit", async () => {
    const context = setup();
    await runToEnd(context);
    context.clock.time = at("2026-11-27T10:30:00.000Z");
    await runToEnd(context);
    context.clock.time = at("2026-11-27T11:00:00.000Z");
    await runToEnd(context);

    const runs = await context.service.listRuns(2);

    expect(runs.map((run) => run.startedAt.toISOString())).toEqual([
      "2026-11-27T11:00:00.000Z",
      "2026-11-27T10:30:00.000Z",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Requirements: Last successful synchronization and Synchronization status
// ---------------------------------------------------------------------------

describe("last successful synchronization and status", () => {
  it("is not moved by a failed run", async () => {
    const context = setup();
    context.clock.time = at("2026-11-27T10:00:00.000Z");
    await runToEnd(context);
    context.erpState.failures.set(CUSTOMERS, networkError(CUSTOMERS));
    context.clock.time = at("2026-11-27T10:30:00.000Z");
    await runToEnd(context);

    const status = await context.service.getStatus();

    expect(status.lastSuccessfulSyncAt).toEqual(
      new Date("2026-11-27T10:00:00.000Z"),
    );
    expect(status.erpAvailable).toBe(false);
  });

  it("is not moved by a partial run", async () => {
    const context = setup();
    await runToEnd(context);
    context.erpState.data.customers[0] = erpCustomer(1, { status: "SUSPENSO" });
    context.clock.time = at("2026-11-27T10:30:00.000Z");
    const partial = await runToEnd(context);

    const status = await context.service.getStatus();

    expect(partial.result).toBe("PARTIAL");
    expect(status.lastSuccessfulSyncAt).toEqual(
      new Date("2026-11-27T10:00:00.000Z"),
    );
    expect(status.erpAvailable).toBe(true);
  });

  it("is empty when no run has succeeded, and the ERP is down when the only run failed", async () => {
    const context = setup();
    context.erpState.failures.set(CUSTOMERS, networkError(CUSTOMERS));
    await runToEnd(context);

    const status = await context.service.getStatus();

    expect(status.lastSuccessfulSyncAt).toBeNull();
    expect(status.erpAvailable).toBe(false);
  });

  it("reports a healthy ERP after a successful run", async () => {
    const context = setup();
    await runToEnd(context);

    const status = await context.service.getStatus();

    expect(status).toEqual({
      lastSuccessfulSyncAt: new Date("2026-11-27T10:00:00.000Z"),
      running: false,
      erpAvailable: true,
    });
  });

  it("does not call a rate-limited ERP down", async () => {
    const context = setup();
    context.erpState.failures.set(CUSTOMERS, rateLimitError(CUSTOMERS));
    await runToEnd(context);

    const status = await context.service.getStatus();

    expect(status.erpAvailable).toBe(true);
  });

  it("reports unknown availability and no time before any run has finished", async () => {
    const context = setup();

    const status = await context.service.getStatus();

    expect(status).toEqual({
      lastSuccessfulSyncAt: null,
      running: false,
      erpAvailable: null,
    });
  });

  it("reports a run in progress", async () => {
    const context = setup();
    let release: () => void = () => undefined;
    context.erpState.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = await context.service.startRun("AUTOMATIC");

    const during = await context.service.getStatus();
    release();
    await started?.completion;
    const after = await context.service.getStatus();

    expect(during.running).toBe(true);
    expect(after.running).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Requirements: skip while running, interrupted runs, idle wait
// ---------------------------------------------------------------------------

describe("only one run at a time", () => {
  it("starts nothing while a run is in progress, records nothing, and calls no ERP", async () => {
    const context = setup();
    let release: () => void = () => undefined;
    context.erpState.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = await context.service.startRun("AUTOMATIC");
    const callsWhileFirstRuns = context.erpState.calls.length;

    const second = await context.service.startRun("MANUAL");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(context.repository.runs).toHaveLength(1);
    expect(context.erpState.calls).toHaveLength(callsWhileFirstRuns);
    release();
    await first?.completion;
  });

  it("lets only one of two simultaneous starts win", async () => {
    const context = setup();

    const results = await Promise.all([
      context.service.startRun("AUTOMATIC"),
      context.service.startRun("MANUAL"),
    ]);

    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    expect(context.repository.runs).toHaveLength(1);
    await winners[0]?.completion;
  });

  it("allows a new run once the previous one has ended", async () => {
    const context = setup();
    await runToEnd(context);

    const next = await context.service.startRun("AUTOMATIC");

    expect(next).not.toBeNull();
    await next?.completion;
  });

  it("frees the slot even when the run fails", async () => {
    const context = setup();
    context.erpState.failures.set(CUSTOMERS, networkError(CUSTOMERS));
    const failed = await runToEnd(context);

    const next = await context.service.startRun("AUTOMATIC");

    expect(failed.result).toBe("FAILED");
    expect(next).not.toBeNull();
    await next?.completion;
  });
});

describe("interrupted runs", () => {
  it("completes a run that never ended as FAILED with an interruption detail", async () => {
    const context = setup();
    await context.repository.startRun({
      kind: "AUTOMATIC",
      startedAt: new Date(at("2026-11-27T09:30:00.000Z")),
    });

    const closed = await context.service.recoverInterruptedRuns();
    const next = await context.service.startRun("AUTOMATIC");

    expect(closed).toBe(1);
    expect(context.repository.runs[0]).toMatchObject({
      result: "FAILED",
      finishedAt: new Date(context.clock.time),
    });
    expect(context.repository.runs[0]?.errorDetail).toMatch(/interrupted/i);
    expect(next).not.toBeNull();
    await next?.completion;
  });
});

describe("waiting for the service to be idle", () => {
  it("resolves at once when nothing is running", async () => {
    const context = setup();

    await expect(context.service.waitForIdle()).resolves.toBeUndefined();
  });

  it("resolves only after the run in progress has ended", async () => {
    const context = setup();
    let release: () => void = () => undefined;
    context.erpState.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = await context.service.startRun("MANUAL");
    expect(started).not.toBeNull();
    let idle = false;
    const waiting = context.service.waitForIdle().then(() => {
      idle = true;
    });

    await Promise.resolve();
    expect(idle).toBe(false);
    release();
    await waiting;

    expect(idle).toBe(true);
    expect(context.repository.runs[0]?.result).toBe("SUCCESS");
  });
});
