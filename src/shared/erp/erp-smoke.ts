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

const resources: { name: string; path: string; schema: z.ZodType }[] = [
  {
    name: "clientes",
    path: "/v1/clientes?pagina=1&tamanho=1",
    schema: erpPageSchema(erpCustomerSchema),
  },
  {
    name: "produtos",
    path: "/v1/produtos?pagina=1&tamanho=1",
    schema: erpPageSchema(erpProductSchema),
  },
  {
    name: "titulos",
    path: "/v1/titulos?pagina=1&tamanho=1",
    schema: erpPageSchema(erpReceivableSchema),
  },
];

// Manual smoke check: one read per resource, printing only counts and timing.
// Stops at the first failure to spare the shared ERP quota.
export async function runErpSmoke(options: ErpSmokeOptions): Promise<boolean> {
  for (const resource of resources) {
    const startedAt = options.now();
    try {
      const page = (await options.client.erpGet(
        resource.path,
        resource.schema,
      )) as { dados: unknown[]; total: number; totalPaginas: number };
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
  const parts = [`kind=${error.kind}`];
  if (error.status !== undefined) {
    parts.push(`status=${String(error.status)}`);
  }
  parts.push(`attempts=${String(error.attempts)}`);
  if (error.title !== undefined) {
    parts.push(`title=${error.title}`);
  }
  if (error.type !== undefined) {
    parts.push(`type=${error.type}`);
  }
  if (error.requestId !== undefined) {
    parts.push(`requestId=${error.requestId}`);
  }
  if (error.fields !== undefined) {
    parts.push(`fields=${error.fields.join(",")}`);
  }
  if (error.issues !== undefined) {
    parts.push(`issues=${error.issues.join(",")}`);
  }
  return parts.join(" ");
}
