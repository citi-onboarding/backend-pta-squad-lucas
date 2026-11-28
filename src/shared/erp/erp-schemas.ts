import { z } from "zod";

// z.int() is already limited to the safe integer range.
export const centsSchema = z.int();

export const erpDateSchema = z.iso.date();

export const erpDateTimeSchema = z.iso.datetime({ offset: true });

export const erpCustomerSchema = z.looseObject({
  codigo: z.string().min(1),
  razaoSocial: z.string(),
  cnpj: z.string().regex(/^\d{14}$/),
  cidade: z.string(),
  uf: z.string(),
  segmento: z.string().min(1),
  limiteCreditoCentavos: centsSchema,
  vendedor: z.string(),
  dataCadastro: erpDateSchema,
  status: z.enum(["ATIVO", "BLOQUEADO", "INATIVO"]),
  atualizadoEm: erpDateTimeSchema,
});

export const erpProductSchema = z.looseObject({
  codigo: z.string().min(1),
  descricao: z.string(),
  categoria: z.string().min(1),
  unidade: z.string().min(1),
  precoTabelaCentavos: centsSchema,
  ativo: z.boolean(),
  atualizadoEm: erpDateTimeSchema,
});

export const erpReceivableSchema = z.looseObject({
  numero: z.int(),
  cliente: z.string().min(1),
  pedidoErp: z.int(),
  parcela: z.string(),
  valorCentavos: centsSchema,
  emissao: erpDateSchema,
  vencimento: erpDateSchema,
  pagamento: erpDateSchema.nullable(),
  // Closed list documented in the ERP `Titulo` schema (P2-status).
  status: z.enum(["PAGO", "EM_ABERTO", "VENCIDO"]),
  atualizadoEm: erpDateTimeSchema,
});

export function erpPageSchema<T extends z.ZodType>(itemSchema: T) {
  return z.looseObject({
    dados: z.array(itemSchema),
    pagina: z.int(),
    tamanho: z.int(),
    total: z.int(),
    totalPaginas: z.int(),
  });
}

export type ErpCustomer = z.infer<typeof erpCustomerSchema>;
export type ErpProduct = z.infer<typeof erpProductSchema>;
export type ErpReceivable = z.infer<typeof erpReceivableSchema>;
