import type { z } from "zod";

import type { ErpClient } from "./erp-client.js";
import { ErpError } from "./erp-error.js";
import {
  erpCustomerSchema,
  erpPageSchema,
  erpProductSchema,
  erpReceivableSchema,
} from "./erp-schemas.js";

export interface ErpSmokeOptions {
  client: ErpClient;
  now: () => number;
  print: (line: string) => void;
}

interface SmokePage {
  dados: unknown[];
  total: number;
  totalPaginas: number;
}

const FIRST_ITEM_QUERY = "?pagina=1&tamanho=1";

const resources: {
  name: string;
  path: string;
  schema: z.ZodType<SmokePage>;
}[] = [
  {
    name: "clientes",
    path: `/v1/clientes${FIRST_ITEM_QUERY}`,
    schema: erpPageSchema(erpCustomerSchema),
  },
  {
    name: "produtos",
    path: `/v1/produtos${FIRST_ITEM_QUERY}`,
    schema: erpPageSchema(erpProductSchema),
  },
  {
    name: "titulos",
    path: `/v1/titulos${FIRST_ITEM_QUERY}`,
    schema: erpPageSchema(erpReceivableSchema),
  },
];

// Manual smoke check: one read per resource, printing only counts and timing.
// Stops at the first failure to spare the shared ERP quota.
export async function runErpSmoke(options: ErpSmokeOptions): Promise<boolean> {
  for (const resource of resources) {
    const startedAt = options.now();
    try {
      const page = await options.client.erpGet(resource.path, resource.schema);
      const elapsedMs = options.now() - startedAt;
      options.print(
        `${resource.name} elapsedMs=${String(elapsedMs)} records=${String(page.dados.length)} total=${String(page.total)} totalPaginas=${String(page.totalPaginas)}`,
      );
    } catch (error) {
      options.print(`${resource.name} FAILED ${describeFailure(error)}`);
      return false;
    }
  }
  return true;
}

function describeFailure(error: unknown): string {
  if (!(error instanceof ErpError)) {
    return "kind=unexpected";
  }
  const facts: [string, string | number | string[] | undefined][] = [
    ["kind", error.kind],
    ["status", error.status],
    ["attempts", error.attempts],
    ["title", error.title],
    ["type", error.type],
    ["requestId", error.requestId],
    ["fields", error.fields],
    ["issues", error.issues],
  ];
  return facts
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(" ");
}
