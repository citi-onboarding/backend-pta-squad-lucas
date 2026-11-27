import type { Database } from "../../shared/database/create-database.js";
import type {
  ErpSyncRepository,
  RunCompletion,
  RunRecord,
  SyncKind,
  SyncRunResult,
  SyncSnapshot,
} from "./erp-sync.service.js";

// One run writes about 650 rows, which can exceed Prisma's 5 second default.
const WRITE_TRANSACTION_TIMEOUT_MS = 60_000;

export class PrismaErpSyncRepository implements ErpSyncRepository {
  constructor(private readonly database: Database) {}

  async startRun(run: { kind: SyncKind; startedAt: Date }): Promise<string> {
    const created = await this.database.syncRun.create({
      data: { kind: run.kind, startedAt: run.startedAt },
      select: { id: true },
    });
    return created.id;
  }

  async finishRun(id: string, completion: RunCompletion): Promise<void> {
    await this.database.syncRun.update({
      where: { id },
      data: {
        finishedAt: completion.finishedAt,
        result: completion.result,
        recordsRead: completion.recordsRead,
        recordsChanged: completion.recordsChanged,
        errorDetail: completion.errorDetail,
      },
    });
  }

  async closeOpenRuns(finishedAt: Date, errorDetail: string): Promise<number> {
    const closed = await this.database.syncRun.updateMany({
      where: { finishedAt: null },
      data: { finishedAt, result: "FAILED", errorDetail },
    });
    return closed.count;
  }

  async listRuns(limit: number): Promise<RunRecord[]> {
    return this.database.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  async findLastSuccessfulFinishedAt(): Promise<Date | null> {
    const run = await this.database.syncRun.findFirst({
      where: { result: "SUCCESS", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    return run?.finishedAt ?? null;
  }

  async findLatestFinishedResult(): Promise<SyncRunResult | null> {
    const run = await this.database.syncRun.findFirst({
      where: { finishedAt: { not: null } },
      orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
      select: { result: true },
    });
    return run?.result ?? null;
  }

  async readSnapshot(): Promise<SyncSnapshot> {
    const [customers, products, receivables] = await Promise.all([
      this.database.customer.findMany(),
      this.database.product.findMany(),
      this.database.receivable.findMany({
        include: { customer: { select: { erpId: true } } },
      }),
    ]);
    return {
      customers: customers.map((customer) => ({
        erpId: customer.erpId,
        name: customer.name,
        cnpj: customer.cnpj,
        city: customer.city,
        state: customer.state,
        segment: customer.segment,
        status: customer.status,
        creditLimitCents: customer.creditLimitCents,
        erpSellerName: customer.erpSellerName ?? "",
      })),
      products: products.map((product) => ({
        erpId: product.erpId,
        description: product.description,
        category: product.category,
        unit: product.unit,
        listPriceCents: product.listPriceCents,
        active: product.active,
      })),
      receivables: receivables.map((receivable) => ({
        erpId: receivable.erpId,
        customerErpId: receivable.customer.erpId,
        erpOrderNumber: receivable.erpOrderNumber,
        installment: receivable.installment,
        amountCents: receivable.amountCents,
        issuedAt: receivable.issuedAt,
        dueDate: receivable.dueDate,
        paidAt: receivable.paidAt,
        status: receivable.status,
      })),
    };
  }

  // One transaction: if any write fails, nothing from the run is stored.
  async applyChanges(changes: SyncSnapshot): Promise<void> {
    await this.database.$transaction(
      async (transaction) => {
        for (const customer of changes.customers) {
          await transaction.customer.upsert({
            where: { erpId: customer.erpId },
            create: customer,
            update: customer,
          });
        }
        for (const product of changes.products) {
          await transaction.product.upsert({
            where: { erpId: product.erpId },
            create: product,
            update: product,
          });
        }
        const codes = [
          ...new Set(changes.receivables.map((r) => r.customerErpId)),
        ];
        const customers = await transaction.customer.findMany({
          where: { erpId: { in: codes } },
          select: { id: true, erpId: true },
        });
        const idByCode = new Map(customers.map((c) => [c.erpId, c.id]));
        for (const receivable of changes.receivables) {
          const { customerErpId, ...fields } = receivable;
          const customerId = idByCode.get(customerErpId);
          if (customerId === undefined) {
            throw new Error(
              "A receivable refers to a customer that is not stored.",
            );
          }
          await transaction.receivable.upsert({
            where: { erpId: receivable.erpId },
            create: { ...fields, customerId },
            update: { ...fields, customerId },
          });
        }
      },
      { timeout: WRITE_TRANSACTION_TIMEOUT_MS },
    );
  }
}
