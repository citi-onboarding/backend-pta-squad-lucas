import { describe, expect, it } from "vitest";

import { createErpClient } from "./erp-client.js";
import { runErpSmoke } from "./erp-smoke.js";

const fakeApiKey = "fake-erp-key-for-tests";
const recordSentinel = "SENTINEL-record-value";
const messageSentinel = "SENTINEL-mensagem-repeating-a-sent-value";

const customer = {
  codigo: "C9001",
  razaoSocial: `Fictitious Distributor ${recordSentinel}`,
  cnpj: "12345678000100",
  cidade: "Fictitious City",
  uf: "ZZ",
  segmento: "Fictitious Segment",
  limiteCreditoCentavos: 100_000,
  vendedor: "Fictitious Seller",
  dataCadastro: "2026-01-01",
  status: "ATIVO",
  atualizadoEm: "2026-01-01T00:00:00-03:00",
};

const product = {
  codigo: "P90001",
  descricao: `Fictitious Product ${recordSentinel}`,
  categoria: "Fictitious Category",
  unidade: "UN",
  precoTabelaCentavos: 1_990,
  ativo: true,
  atualizadoEm: "2026-01-01T00:00:00-03:00",
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
  atualizadoEm: "2026-10-05T00:00:00-03:00",
};

const envelope = (record: unknown, total: number, totalPaginas: number) => ({
  dados: [record],
  pagina: 1,
  tamanho: 1,
  total,
  totalPaginas,
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(responses: Response[]) {
  const urls: string[] = [];
  const lines: string[] = [];
  let clock = 0;
  const queue = [...responses];
  const client = createErpClient({
    baseUrl: "https://erp.example.invalid",
    apiKey: fakeApiKey,
    timeoutMs: 1_000,
    fetch: (input) => {
      urls.push(input as string);
      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected extra fetch call");
      }
      return Promise.resolve(next);
    },
    sleep: () => Promise.resolve(),
  });
  // Each read starts and ends one clock reading: 250 ms per resource.
  const now = () => {
    clock += 125;
    return clock;
  };
  const run = () => runErpSmoke({ client, now, print: (l) => lines.push(l) });
  return { run, urls, lines };
}

describe("runErpSmoke", () => {
  it("reads each resource once with page size 1 and prints one line per resource", async () => {
    const { run, urls, lines } = setup([
      jsonResponse(200, envelope(customer, 120, 120)),
      jsonResponse(200, envelope(product, 60, 60)),
      jsonResponse(200, envelope(receivable, 472, 472)),
    ]);

    const ok = await run();

    expect(ok).toBe(true);
    expect(urls).toEqual([
      "https://erp.example.invalid/v1/clientes?pagina=1&tamanho=1",
      "https://erp.example.invalid/v1/produtos?pagina=1&tamanho=1",
      "https://erp.example.invalid/v1/titulos?pagina=1&tamanho=1",
    ]);
    expect(lines).toEqual([
      "clientes elapsedMs=125 records=1 total=120 totalPaginas=120",
      "produtos elapsedMs=125 records=1 total=60 totalPaginas=60",
      "titulos elapsedMs=125 records=1 total=472 totalPaginas=472",
    ]);
  });

  it("prints no record content and no API key", async () => {
    const { run, lines } = setup([
      jsonResponse(200, envelope(customer, 120, 120)),
      jsonResponse(200, envelope(product, 60, 60)),
      jsonResponse(200, envelope(receivable, 472, 472)),
    ]);

    await run();

    const output = lines.join("\n");
    for (const forbidden of [
      recordSentinel,
      "C9001",
      "12345678000100",
      fakeApiKey,
      "x-api-key",
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it("stops at the first failure and prints only safe error facts", async () => {
    const { run, urls, lines } = setup([
      jsonResponse(200, envelope(customer, 120, 120)),
      new Response(
        JSON.stringify({
          type: "https://erp.example.invalid/problems/unprocessable",
          title: "Fictitious Unprocessable Entity",
          status: 422,
          detail: messageSentinel,
          instance: "/v1/produtos?pagina=1&tamanho=1",
          requestId: "req-fake-0422",
          erros: [{ campo: "tamanho", mensagem: messageSentinel }],
        }),
        {
          status: 422,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    ]);

    const ok = await run();

    expect(ok).toBe(false);
    expect(urls).toHaveLength(2);
    expect(lines).toEqual([
      "clientes elapsedMs=125 records=1 total=120 totalPaginas=120",
      "produtos FAILED kind=http status=422 attempts=1 title=Fictitious Unprocessable Entity type=https://erp.example.invalid/problems/unprocessable requestId=req-fake-0422 fields=tamanho",
    ]);
    expect(lines.join("\n")).not.toContain(messageSentinel);
  });

  it("prints only the failing field paths of an invalid response", async () => {
    const { run, lines } = setup([
      jsonResponse(200, {
        ...envelope({ ...customer, cnpj: recordSentinel }, 120, 120),
      }),
    ]);

    const ok = await run();

    expect(ok).toBe(false);
    expect(lines).toEqual([
      "clientes FAILED kind=invalid-response status=200 attempts=1 issues=dados.0.cnpj",
    ]);
    expect(lines.join("\n")).not.toContain(recordSentinel);
  });

  it("prints a generic line for an error that is not an ERP error", async () => {
    const lines: string[] = [];
    const ok = await runErpSmoke({
      client: {
        erpGet: () => Promise.reject(new Error(`boom ${fakeApiKey}`)),
      },
      now: () => 0,
      print: (line) => lines.push(line),
    });

    expect(ok).toBe(false);
    expect(lines).toEqual(["clientes FAILED kind=unexpected"]);
    expect(lines.join("\n")).not.toContain(fakeApiKey);
  });
});
