import type { z } from "zod";

import { ErpError, issuePaths } from "../../src/shared/erp/erp-error.js";
import type { ErpClient } from "../../src/shared/erp/erp-client.js";

// Invented ERP data and a fake ERP client for the synchronization tests. Only
// the external ERP is faked; nothing here calls the network.

export const CUSTOMERS = "/v1/clientes";
export const PRODUCTS = "/v1/produtos";
export const RECEIVABLES = "/v1/titulos";

export function erpCustomer(
  n: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    codigo: `C${String(n)}`,
    razaoSocial: `Mercado Invented ${String(n)}`,
    cnpj: String(n).padStart(14, "0"),
    cidade: "Recife",
    uf: "PE",
    segmento: "Varejo",
    limiteCreditoCentavos: 1_000_000,
    vendedor: "Seller Invented",
    dataCadastro: "2026-01-10",
    status: "ATIVO",
    atualizadoEm: "2026-11-20T10:00:00-03:00",
    ...overrides,
  };
}

export function erpProduct(n: number, overrides: Record<string, unknown> = {}) {
  return {
    codigo: `P${String(n)}`,
    descricao: `Product Invented ${String(n)}`,
    categoria: "Bebidas",
    unidade: "UN",
    precoTabelaCentavos: 1_050,
    ativo: true,
    atualizadoEm: "2026-11-20T10:00:00-03:00",
    ...overrides,
  };
}

export function erpReceivable(
  n: number,
  customerCode: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    numero: 1_000 + n,
    cliente: customerCode,
    pedidoErp: 5_000 + n,
    parcela: "1/1",
    valorCentavos: 300_000,
    emissao: "2026-10-05",
    vencimento: "2026-11-04",
    pagamento: null,
    status: "EM_ABERTO",
    atualizadoEm: "2026-11-20T10:00:00-03:00",
    ...overrides,
  };
}

export interface ErpData {
  customers: unknown[];
  products: unknown[];
  receivables: unknown[];
}

export function sampleData(): ErpData {
  return {
    customers: [erpCustomer(1), erpCustomer(2), erpCustomer(3)],
    products: [erpProduct(1), erpProduct(2)],
    receivables: [
      erpReceivable(1, "C1"),
      erpReceivable(2, "C1", { parcela: "2/2" }),
      erpReceivable(3, "C2", { status: "VENCIDO" }),
      erpReceivable(4, "C2", { status: "PAGO", pagamento: "2026-11-01" }),
    ],
  };
}

export const resourceKey: Record<string, keyof ErpData> = {
  [CUSTOMERS]: "customers",
  [PRODUCTS]: "products",
  [RECEIVABLES]: "receivables",
};

export function createFakeErp(data: ErpData = sampleData()) {
  const state = {
    data,
    perPage: 50,
    calls: [] as string[],
    failures: new Map<string, Error>(),
    overrides: new Map<string, unknown>(),
    // Answers a path page by page, for cases where pages disagree with each other.
    pageBodies: new Map<string, (page: number) => unknown>(),
    gate: undefined as Promise<void> | undefined,
  };

  const erpGet = async <T extends z.ZodType>(
    path: string,
    schema: T,
  ): Promise<z.output<T>> => {
    state.calls.push(path);
    const url = new URL(path, "https://erp.example.invalid");
    if (state.gate) {
      await state.gate;
    }
    const failure = state.failures.get(url.pathname);
    if (failure) {
      throw failure;
    }
    const key = resourceKey[url.pathname];
    if (!key) {
      throw new Error(`Unexpected ERP path ${url.pathname}`);
    }
    const page = Number(url.searchParams.get("pagina") ?? "1");
    const records = state.data[key];
    const pageBody = state.pageBodies.get(url.pathname);
    const body = pageBody
      ? pageBody(page)
      : state.overrides.has(url.pathname)
        ? state.overrides.get(url.pathname)
        : {
            dados: records.slice(
              (page - 1) * state.perPage,
              page * state.perPage,
            ),
            pagina: page,
            tamanho: state.perPage,
            total: records.length,
            totalPaginas: Math.max(
              1,
              Math.ceil(records.length / state.perPage),
            ),
          };
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Mirrors the real client: only field paths, never values.
      throw new ErpError({
        kind: "invalid-response",
        path: url.pathname,
        attempts: 1,
        status: 200,
        issues: issuePaths(parsed.error.issues),
      });
    }
    return parsed.data;
  };

  return { state, erp: { erpGet } as Pick<ErpClient, "erpGet"> };
}

// Narrows a value that a previous assertion already proved to exist, without a
// non-null assertion (which the lint rules forbid).
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("Expected a value.");
  }
  return value;
}
