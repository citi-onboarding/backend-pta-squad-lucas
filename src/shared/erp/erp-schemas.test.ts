import { describe, expect, it } from "vitest";

import {
  erpCustomerSchema,
  erpPageSchema,
  erpProductSchema,
  erpReceivableSchema,
} from "./erp-schemas.js";

// Invented records that follow the confirmed ERP shapes. No real ERP data.
const customer = {
  codigo: "C9001",
  razaoSocial: "Fictitious Distributor Ltda",
  cnpj: "12345678000100",
  cidade: "Fictional City",
  uf: "PE",
  segmento: "Revenda",
  limiteCreditoCentavos: 5_000_000,
  vendedor: "Fictitious Seller",
  dataCadastro: "2025-03-14",
  status: "ATIVO",
  atualizadoEm: "2026-11-20T09:15:00-03:00",
};

const product = {
  codigo: "P09001",
  descricao: "Fictitious cable 2.5 mm",
  categoria: "Cabos",
  unidade: "RL",
  precoTabelaCentavos: 18_990,
  ativo: true,
  atualizadoEm: "2026-11-20T09:15:00-03:00",
};

const receivable = {
  numero: 900_001,
  cliente: "C9001",
  pedidoErp: 700_001,
  parcela: "1/2",
  valorCentavos: 123_456,
  emissao: "2026-10-05",
  vencimento: "2026-11-05",
  pagamento: null,
  status: "EM_ABERTO",
  atualizadoEm: "2026-11-20T09:15:00-03:00",
};

function page<T>(dados: T[]) {
  return {
    dados,
    pagina: 1,
    tamanho: 20,
    total: dados.length,
    totalPaginas: 1,
  };
}

describe("ERP customer schema", () => {
  it("accepts a valid list envelope of customers", () => {
    const result = erpPageSchema(erpCustomerSchema).safeParse(page([customer]));

    expect(result.success).toBe(true);
    expect(result.data).toEqual(page([customer]));
  });

  it.each(["ATIVO", "BLOQUEADO", "INATIVO"])("accepts status %s", (status) => {
    expect(erpCustomerSchema.safeParse({ ...customer, status }).success).toBe(
      true,
    );
  });

  it("accepts unknown extra fields", () => {
    expect(
      erpCustomerSchema.safeParse({ ...customer, campoNovo: "x" }).success,
    ).toBe(true);
  });

  it.each([
    ["a missing razaoSocial", { razaoSocial: undefined }],
    ["a cnpj with a mask", { cnpj: "12.345.678/0001-00" }],
    ["a cnpj with 13 digits", { cnpj: "1234567800010" }],
    ["an unknown status", { status: "SUSPENSO" }],
    ["a malformed dataCadastro", { dataCadastro: "14/03/2025" }],
    ["an atualizadoEm without offset", { atualizadoEm: "2026-11-20T09:15:00" }],
    ["a fractional limiteCreditoCentavos", { limiteCreditoCentavos: 10.5 }],
    ["a string limiteCreditoCentavos", { limiteCreditoCentavos: "5000000" }],
  ])("rejects %s", (_label, override) => {
    expect(
      erpCustomerSchema.safeParse({ ...customer, ...override }).success,
    ).toBe(false);
  });
});

describe("ERP product schema", () => {
  it("accepts a valid product", () => {
    expect(erpProductSchema.safeParse(product).data).toEqual(product);
  });

  it("accepts unknown extra fields", () => {
    expect(
      erpProductSchema.safeParse({ ...product, campoNovo: 1 }).success,
    ).toBe(true);
  });

  it.each([
    ["a missing descricao", { descricao: undefined }],
    ["a non-boolean ativo", { ativo: "true" }],
    ["a fractional precoTabelaCentavos", { precoTabelaCentavos: 189.9 }],
    ["an unsafe precoTabelaCentavos", { precoTabelaCentavos: 2 ** 53 }],
  ])("rejects %s", (_label, override) => {
    expect(
      erpProductSchema.safeParse({ ...product, ...override }).success,
    ).toBe(false);
  });
});

describe("ERP receivable schema", () => {
  it("accepts a receivable whose pagamento is null", () => {
    expect(erpReceivableSchema.safeParse(receivable).data).toEqual(receivable);
  });

  it("accepts a paid receivable with a pagamento date", () => {
    const paid = { ...receivable, pagamento: "2026-11-04", status: "PAGO" };

    expect(erpReceivableSchema.safeParse(paid).success).toBe(true);
  });

  it.each(["PAGO", "EM_ABERTO", "VENCIDO"])(
    "accepts the documented receivable status %s",
    (status) => {
      expect(
        erpReceivableSchema.safeParse({ ...receivable, status }).success,
      ).toBe(true);
    },
  );

  it.each(["CANCELADO", "pago", "Em_Aberto"])(
    "rejects the undocumented receivable status %s",
    (status) => {
      const result = erpReceivableSchema.safeParse({ ...receivable, status });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(
        ["status"],
      );
    },
  );

  it("accepts two installments of the same pedidoErp", () => {
    const installments = [
      receivable,
      { ...receivable, numero: 900_002, parcela: "2/2" },
    ];

    const result = erpPageSchema(erpReceivableSchema).safeParse(
      page(installments),
    );

    expect(result.success).toBe(true);
    expect(result.data?.dados).toHaveLength(2);
  });

  it.each([
    ["a string numero", { numero: "900001" }],
    ["a missing pedidoErp", { pedidoErp: undefined }],
    ["an empty status", { status: "" }],
    ["a malformed vencimento", { vencimento: "2026-13-05" }],
    ["an undefined pagamento", { pagamento: undefined }],
    ["a fractional valorCentavos", { valorCentavos: 1234.56 }],
  ])("rejects %s", (_label, override) => {
    expect(
      erpReceivableSchema.safeParse({ ...receivable, ...override }).success,
    ).toBe(false);
  });
});

describe("ERP page envelope schema", () => {
  it("rejects an envelope without totalPaginas", () => {
    const incomplete = { ...page([product]), totalPaginas: undefined };

    expect(erpPageSchema(erpProductSchema).safeParse(incomplete).success).toBe(
      false,
    );
  });

  it("rejects an envelope whose dados contains an invalid record", () => {
    const invalid = page([{ ...product, ativo: "sim" }]);

    expect(erpPageSchema(erpProductSchema).safeParse(invalid).success).toBe(
      false,
    );
  });

  it("rejects fractional paging fields", () => {
    expect(
      erpPageSchema(erpProductSchema).safeParse({
        ...page([product]),
        pagina: 1.5,
      }).success,
    ).toBe(false);
  });
});
