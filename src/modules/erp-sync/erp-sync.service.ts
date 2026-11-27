import { z } from "zod";

import type { ErpClient } from "../../shared/erp/erp-client.js";
import { ErpError, issuePaths } from "../../shared/erp/erp-error.js";
import {
  erpCustomerSchema,
  erpPageSchema,
  erpProductSchema,
  erpReceivableSchema,
} from "../../shared/erp/erp-schemas.js";

export type SyncKind = "AUTOMATIC" | "MANUAL";
export type SyncRunResult = "SUCCESS" | "PARTIAL" | "FAILED" | "RATE_LIMITED";
// The ERP only sends the first three; PROSPECT can exist in stored rows.
export type SyncedCustomerStatus =
  "ACTIVE" | "BLOCKED" | "INACTIVE" | "PROSPECT";
export type SyncedReceivableStatus = "PAID" | "OPEN" | "OVERDUE";

export interface SyncedCustomer {
  erpId: string;
  name: string;
  cnpj: string;
  city: string;
  state: string;
  segment: string;
  status: SyncedCustomerStatus;
  creditLimitCents: number;
  erpSellerName: string;
}

export interface SyncedProduct {
  erpId: string;
  description: string;
  category: string;
  unit: string;
  listPriceCents: number;
  active: boolean;
}

export interface SyncedReceivable {
  erpId: number;
  customerErpId: string;
  erpOrderNumber: number;
  installment: string;
  amountCents: number;
  issuedAt: Date;
  dueDate: Date;
  paidAt: Date | null;
  status: SyncedReceivableStatus;
}

export interface SyncSnapshot {
  customers: SyncedCustomer[];
  products: SyncedProduct[];
  receivables: SyncedReceivable[];
}

export interface RunRecord {
  id: string;
  kind: SyncKind;
  startedAt: Date;
  finishedAt: Date | null;
  result: SyncRunResult | null;
  recordsRead: number;
  recordsChanged: number;
  errorDetail: string | null;
}

export interface RunCompletion {
  finishedAt: Date;
  result: SyncRunResult;
  recordsRead: number;
  recordsChanged: number;
  errorDetail: string | null;
}

// Persistence port. `applyChanges` writes everything or nothing.
export interface ErpSyncRepository {
  startRun(run: { kind: SyncKind; startedAt: Date }): Promise<string>;
  finishRun(id: string, completion: RunCompletion): Promise<void>;
  closeOpenRuns(finishedAt: Date, errorDetail: string): Promise<number>;
  listRuns(limit: number): Promise<RunRecord[]>;
  findLastSuccessfulFinishedAt(): Promise<Date | null>;
  findLatestFinishedResult(): Promise<SyncRunResult | null>;
  readSnapshot(): Promise<SyncSnapshot>;
  applyChanges(changes: SyncSnapshot): Promise<void>;
}

export interface SyncLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface SyncStatus {
  lastSuccessfulSyncAt: Date | null;
  running: boolean;
  erpAvailable: boolean | null;
}

export interface StartedSync {
  run: Pick<RunRecord, "id" | "kind" | "startedAt">;
  completion: Promise<RunRecord>;
}

export interface ErpSyncService {
  startRun(kind: SyncKind): Promise<StartedSync | null>;
  getStatus(): Promise<SyncStatus>;
  listRuns(limit: number): Promise<RunRecord[]>;
  recoverInterruptedRuns(): Promise<number>;
  waitForIdle(): Promise<void>;
}

export interface ErpSyncServiceDependencies {
  erp: Pick<ErpClient, "erpGet">;
  repository: ErpSyncRepository;
  now: () => Date;
  logger: SyncLogger;
}

const CUSTOMERS_PATH = "/v1/clientes";
const PRODUCTS_PATH = "/v1/produtos";
const RECEIVABLES_PATH = "/v1/titulos";
// The documented maximum. The read follows the server's own `totalPaginas`, so a
// smaller accepted size still works.
const PAGE_SIZE = 50;
// A resource announcing more pages than this fails the run: it bounds the quota one
// run can spend (the real ERP needs 10 pages at most today).
const MAX_PAGES = 100;

// Records are checked one by one afterwards, so one bad record never drops a page.
const looseListSchema = erpPageSchema(z.unknown());

type Resource = "customers" | "products" | "receivables";

class PageLimitError extends Error {
  constructor(readonly path: string) {
    super(`ERP list ${path} announces more than ${String(MAX_PAGES)} pages.`);
    this.name = "PageLimitError";
  }
}

interface Rejections {
  count: number;
  fields: Set<string>;
}

interface Outcome {
  result: SyncRunResult;
  recordsRead: number;
  recordsChanged: number;
  errorDetail: string | null;
}

const customerStatus = {
  ATIVO: "ACTIVE",
  BLOQUEADO: "BLOCKED",
  INATIVO: "INACTIVE",
} as const;

const receivableStatus = {
  PAGO: "PAID",
  EM_ABERTO: "OPEN",
  VENCIDO: "OVERDUE",
} as const;

// ERP dates are plain dates; they are stored as midnight UTC.
function toDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function sameRecord(left: object, right: object): boolean {
  const rightRecord = right as Record<string, unknown>;
  return Object.entries(left).every(([key, value]) => {
    const other = rightRecord[key];
    return value instanceof Date
      ? other instanceof Date && value.getTime() === other.getTime()
      : value === other;
  });
}

function changedOnly<T extends object>(
  incoming: T[],
  stored: T[],
  keyOf: (record: T) => string | number,
): T[] {
  const byKey = new Map(stored.map((record) => [keyOf(record), record]));
  return incoming.filter((record) => {
    const existing = byKey.get(keyOf(record));
    return existing === undefined || !sameRecord(record, existing);
  });
}

// Safe details only: counts and field names, never record values.
function describeRejections(
  rejections: Record<Resource, Rejections>,
): string | null {
  const parts = (Object.keys(rejections) as Resource[])
    .filter((resource) => rejections[resource].count > 0)
    .map((resource) => {
      const { count, fields } = rejections[resource];
      return `${resource}: ${String(count)} rejected (${[...fields].sort().join(", ")})`;
    });
  return parts.length === 0 ? null : `Rejected records - ${parts.join("; ")}`;
}

function describeFailure(error: unknown): {
  result: SyncRunResult;
  detail: string;
  unexpected?: true;
} {
  if (error instanceof PageLimitError) {
    return { result: "FAILED", detail: error.message };
  }
  if (error instanceof ErpError) {
    if (error.kind === "http" && error.status === 429) {
      return {
        result: "RATE_LIMITED",
        detail: `ERP rate limit reached (status 429) on ${error.path} after ${String(error.attempts)} attempts`,
      };
    }
    return { result: "FAILED", detail: error.message };
  }
  return {
    result: "FAILED",
    detail: "Unexpected error during synchronization.",
    unexpected: true,
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

export function createErpSyncService(
  dependencies: ErpSyncServiceDependencies,
): ErpSyncService {
  const { erp, repository, now, logger } = dependencies;
  let busy = false;
  let current: Promise<RunRecord> | undefined;

  async function readAll(path: string): Promise<unknown[]> {
    const records: unknown[] = [];
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page += 1) {
      const list = await erp.erpGet(
        `${path}?pagina=${String(page)}&tamanho=${String(PAGE_SIZE)}`,
        looseListSchema,
      );
      if (page === 1) {
        // The first page fixes the total; later pages cannot move it.
        if (list.totalPaginas > MAX_PAGES) {
          throw new PageLimitError(path);
        }
        totalPages = list.totalPaginas;
      }
      if (list.dados.length === 0) {
        break;
      }
      records.push(...list.dados);
    }
    return records;
  }

  async function synchronize(): Promise<Outcome> {
    // Everything is read before anything is written, so a failed read changes nothing.
    const rawCustomers = await readAll(CUSTOMERS_PATH);
    const rawProducts = await readAll(PRODUCTS_PATH);
    const rawReceivables = await readAll(RECEIVABLES_PATH);
    const snapshot = await repository.readSnapshot();

    const rejections: Record<Resource, Rejections> = {
      customers: { count: 0, fields: new Set() },
      products: { count: 0, fields: new Set() },
      receivables: { count: 0, fields: new Set() },
    };
    const reject = (resource: Resource, fields: string[]) => {
      rejections[resource].count += 1;
      for (const field of fields) {
        rejections[resource].fields.add(field);
      }
    };

    const customers: SyncedCustomer[] = [];
    for (const raw of rawCustomers) {
      const parsed = erpCustomerSchema.safeParse(raw);
      if (!parsed.success) {
        reject("customers", issuePaths(parsed.error.issues));
        continue;
      }
      const record = parsed.data;
      customers.push({
        erpId: record.codigo,
        name: record.razaoSocial,
        cnpj: record.cnpj,
        city: record.cidade,
        state: record.uf,
        segment: record.segmento,
        status: customerStatus[record.status],
        creditLimitCents: record.limiteCreditoCentavos,
        erpSellerName: record.vendedor,
      });
    }

    const products: SyncedProduct[] = [];
    for (const raw of rawProducts) {
      const parsed = erpProductSchema.safeParse(raw);
      if (!parsed.success) {
        reject("products", issuePaths(parsed.error.issues));
        continue;
      }
      const record = parsed.data;
      products.push({
        erpId: record.codigo,
        description: record.descricao,
        category: record.categoria,
        unit: record.unidade,
        listPriceCents: record.precoTabelaCentavos,
        active: record.ativo,
      });
    }

    const knownCustomers = new Set([
      ...snapshot.customers.map((customer) => customer.erpId),
      ...customers.map((customer) => customer.erpId),
    ]);
    const receivables: SyncedReceivable[] = [];
    for (const raw of rawReceivables) {
      const parsed = erpReceivableSchema.safeParse(raw);
      if (!parsed.success) {
        reject("receivables", issuePaths(parsed.error.issues));
        continue;
      }
      const record = parsed.data;
      if (!knownCustomers.has(record.cliente)) {
        reject("receivables", ["cliente"]);
        continue;
      }
      receivables.push({
        erpId: record.numero,
        customerErpId: record.cliente,
        erpOrderNumber: record.pedidoErp,
        installment: record.parcela,
        amountCents: record.valorCentavos,
        issuedAt: toDate(record.emissao),
        dueDate: toDate(record.vencimento),
        paidAt: record.pagamento === null ? null : toDate(record.pagamento),
        status: receivableStatus[record.status],
      });
    }

    const changes: SyncSnapshot = {
      customers: changedOnly(customers, snapshot.customers, (r) => r.erpId),
      products: changedOnly(products, snapshot.products, (r) => r.erpId),
      receivables: changedOnly(
        receivables,
        snapshot.receivables,
        (r) => r.erpId,
      ),
    };
    const recordsChanged =
      changes.customers.length +
      changes.products.length +
      changes.receivables.length;
    const recordsRead =
      rawCustomers.length + rawProducts.length + rawReceivables.length;

    if (recordsChanged > 0) {
      try {
        await repository.applyChanges(changes);
      } catch (error) {
        // Database messages can quote values, so only the error name is logged.
        logger.error(
          { errorName: errorName(error) },
          "The database rejected the synchronization changes",
        );
        return {
          result: "FAILED",
          recordsRead,
          recordsChanged: 0,
          errorDetail: "The database rejected the changes.",
        };
      }
    }

    for (const resource of Object.keys(rejections) as Resource[]) {
      if (rejections[resource].count > 0) {
        logger.warn(
          {
            resource,
            rejected: rejections[resource].count,
            fields: [...rejections[resource].fields].sort(),
          },
          "Rejected invalid ERP records",
        );
      }
    }
    const errorDetail = describeRejections(rejections);
    return {
      result: errorDetail === null ? "SUCCESS" : "PARTIAL",
      recordsRead,
      recordsChanged,
      errorDetail,
    };
  }

  // Never rejects: every failure becomes the result of the run.
  async function execute(
    id: string,
    kind: SyncKind,
    startedAt: Date,
  ): Promise<RunRecord> {
    let outcome: Outcome;
    try {
      outcome = await synchronize();
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.unexpected) {
        logger.error(
          { runId: id, kind, errorName: errorName(error) },
          "Unexpected error during ERP synchronization",
        );
      }
      outcome = {
        result: failure.result,
        recordsRead: 0,
        recordsChanged: 0,
        errorDetail: failure.detail,
      };
    }
    const completion: RunCompletion = { finishedAt: now(), ...outcome };
    try {
      await repository.finishRun(id, completion);
    } catch (error) {
      logger.error(
        { runId: id, errorName: errorName(error) },
        "Could not record the end of the synchronization run",
      );
    }
    logger.info(
      {
        runId: id,
        kind,
        result: completion.result,
        recordsRead: completion.recordsRead,
        recordsChanged: completion.recordsChanged,
        durationMs: completion.finishedAt.getTime() - startedAt.getTime(),
      },
      "ERP synchronization finished",
    );
    return { id, kind, startedAt, ...completion };
  }

  async function startRun(kind: SyncKind): Promise<StartedSync | null> {
    // Claimed before any await, so two simultaneous starts cannot both win.
    if (busy) {
      return null;
    }
    busy = true;
    const startedAt = now();
    let id: string;
    try {
      id = await repository.startRun({ kind, startedAt });
    } catch (error) {
      busy = false;
      throw error;
    }
    logger.info({ runId: id, kind }, "ERP synchronization started");
    const completion = execute(id, kind, startedAt).finally(() => {
      busy = false;
      current = undefined;
    });
    current = completion;
    return { run: { id, kind, startedAt }, completion };
  }

  return {
    startRun,
    async getStatus() {
      const [lastSuccessfulSyncAt, latestResult] = await Promise.all([
        repository.findLastSuccessfulFinishedAt(),
        repository.findLatestFinishedResult(),
      ]);
      return {
        lastSuccessfulSyncAt,
        running: busy,
        erpAvailable: latestResult === null ? null : latestResult !== "FAILED",
      };
    },
    listRuns: (limit) => repository.listRuns(limit),
    async recoverInterruptedRuns() {
      const closed = await repository.closeOpenRuns(
        now(),
        "Run was interrupted before it finished.",
      );
      if (closed > 0) {
        logger.warn({ closed }, "Closed interrupted synchronization runs");
      }
      return closed;
    },
    async waitForIdle() {
      while (current !== undefined) {
        await current;
      }
    },
  };
}
