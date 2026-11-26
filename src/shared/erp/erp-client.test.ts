import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErpClient, ERP_API_KEY_HEADER } from "./erp-client.js";
import { ErpError } from "./erp-error.js";
import {
  erpCustomerSchema,
  erpPageSchema,
  erpReceivableSchema,
} from "./erp-schemas.js";

const baseUrl = "https://erp.example.invalid";
const fakeApiKey = "fake-erp-key-must-not-leak";
const fixedNow = Date.UTC(2026, 10, 26, 12, 0, 0);
const okSchema = z.object({ ok: z.literal(true) });

type FetchStep = Response | Error | "hang";

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface LogEntry {
  fields: Record<string, unknown>;
  message: string;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function okResponse() {
  return jsonResponse(200, { ok: true });
}

function timeoutError() {
  return new DOMException(
    "The operation was aborted due to timeout",
    "TimeoutError",
  );
}

// Fakes only external dependencies: HTTP (fetch), time (sleep, now), and the logger.
function setup(steps: FetchStep[], options: { timeoutMs?: number } = {}) {
  const calls: FetchCall[] = [];
  const waits: number[] = [];
  const logs: LogEntry[] = [];

  const fakeFetch: typeof fetch = (input, init = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    calls.push({ url, init });
    const step = steps.shift();
    if (step === undefined) {
      throw new Error("Unexpected extra ERP request.");
    }
    if (step === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error("aborted"));
        });
      });
    }
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  };

  const client = createErpClient({
    baseUrl,
    apiKey: fakeApiKey,
    timeoutMs: options.timeoutMs ?? 60_000,
    fetch: fakeFetch,
    sleep: (milliseconds: number) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
    now: () => fixedNow,
    logger: {
      warn: (fields: Record<string, unknown>, message: string) => {
        logs.push({ fields, message });
      },
    },
  });

  return { client, calls, waits, logs };
}

async function captureErpError(promise: Promise<unknown>): Promise<ErpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ErpError);
    return error as ErpError;
  }
  throw new Error("Expected the ERP read to fail.");
}

const customerPage = {
  dados: [
    {
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
    },
  ],
  pagina: 1,
  tamanho: 20,
  total: 1,
  totalPaginas: 1,
};

describe("erpGet successful read", () => {
  it("returns the validated data after exactly one attempt", async () => {
    const { client, calls, waits } = setup([jsonResponse(200, customerPage)]);

    const result = await client.erpGet(
      "/v1/clientes?pagina=1&tamanho=20",
      erpPageSchema(erpCustomerSchema),
    );

    expect(result).toEqual(customerPage);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("sends one GET to the base URL plus path, with the key in x-api-key only", async () => {
    const { client, calls } = setup([okResponse()]);

    await client.erpGet("/v1/clientes?pagina=1&tamanho=20", okSchema);

    expect(ERP_API_KEY_HEADER).toBe("x-api-key");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`${baseUrl}/v1/clientes?pagina=1&tamanho=20`);
    expect(call?.url).not.toContain(fakeApiKey);
    expect(call?.init.method ?? "GET").toBe("GET");
    expect(new Headers(call?.init.headers).get("X-Api-Key")).toBe(fakeApiKey);
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("erpGet retry on transient failures", () => {
  it("waits and retries after 429, returning the data after 2 attempts", async () => {
    const { client, calls, waits } = setup([
      jsonResponse(429, {}),
      okResponse(),
    ]);

    await expect(client.erpGet("/v1/clientes", okSchema)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2_000]);
  });

  it("follows Retry-After in seconds", async () => {
    const { client, waits } = setup([
      jsonResponse(429, {}, { "retry-after": "7" }),
      okResponse(),
    ]);

    await client.erpGet("/v1/clientes", okSchema);

    expect(waits).toEqual([7_000]);
  });

  it("follows Retry-After as an HTTP date", async () => {
    const inTenSeconds = new Date(fixedNow + 10_000).toUTCString();
    const { client, waits } = setup([
      jsonResponse(429, {}, { "retry-after": inTenSeconds }),
      okResponse(),
    ]);

    await client.erpGet("/v1/clientes", okSchema);

    expect(waits).toEqual([10_000]);
  });

  it("caps Retry-After at 60 seconds", async () => {
    const { client, waits } = setup([
      jsonResponse(429, {}, { "retry-after": "3600" }),
      okResponse(),
    ]);

    await client.erpGet("/v1/clientes", okSchema);

    expect(waits).toEqual([60_000]);
  });

  it.each([
    ["unparseable", "soon"],
    ["negative", "-5"],
    ["in the past", new Date(fixedNow - 10_000).toUTCString()],
  ])("falls back to backoff when Retry-After is %s", async (_label, value) => {
    const { client, waits } = setup([
      jsonResponse(429, {}, { "retry-after": value }),
      okResponse(),
    ]);

    await client.erpGet("/v1/clientes", okSchema);

    expect(waits).toEqual([2_000]);
  });

  it("waits 2 seconds and retries after a 503", async () => {
    const { client, calls, waits } = setup([
      jsonResponse(503, {}),
      okResponse(),
    ]);

    await expect(client.erpGet("/v1/clientes", okSchema)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([2_000]);
  });

  it("retries when the request fails without a response", async () => {
    const { client, calls } = setup([
      new TypeError("fetch failed"),
      okResponse(),
    ]);

    await expect(client.erpGet("/v1/clientes", okSchema)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(2);
  });

  it("retries when the request exceeds the configured timeout", async () => {
    const { client, calls } = setup(["hang", okResponse()], { timeoutMs: 5 });

    await expect(client.erpGet("/v1/clientes", okSchema)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(2);
  });

  it("stops after 5 attempts with backoff 2, 4, 8, 16 s and reports the last failure", async () => {
    const { client, calls, waits } = setup([
      jsonResponse(503, {}),
      jsonResponse(503, {}),
      jsonResponse(503, {}),
      jsonResponse(503, {}),
      jsonResponse(503, {}),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes?pagina=2", okSchema),
    );

    expect(calls).toHaveLength(5);
    expect(waits).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(error.kind).toBe("http");
    expect(error.status).toBe(503);
    expect(error.attempts).toBe(5);
    expect(error.path).toBe("/v1/clientes");
    expect(error.message).toContain("503");
    expect(error.message).toContain("5 attempts");
  });

  it("reports a network failure kind when every attempt fails without a response", async () => {
    const { client } = setup([
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      timeoutError(),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes", okSchema),
    );

    expect(error.kind).toBe("timeout");
    expect(error.status).toBeUndefined();
    expect(error.attempts).toBe(5);
  });

  it("logs one warning per retry with path without query, failure, attempt, and wait only", async () => {
    const { client, logs } = setup([
      jsonResponse(503, {}),
      new TypeError("fetch failed"),
      okResponse(),
    ]);

    await client.erpGet("/v1/clientes?uf=PE&pagina=1", okSchema);

    expect(logs).toEqual([
      {
        fields: {
          path: "/v1/clientes",
          kind: "http",
          status: 503,
          attempt: 1,
          waitMs: 2_000,
        },
        message: "Retrying ERP request",
      },
      {
        fields: {
          path: "/v1/clientes",
          kind: "network",
          attempt: 2,
          waitMs: 4_000,
        },
        message: "Retrying ERP request",
      },
    ]);
  });
});

describe("erpGet immediate failure on non-retryable responses", () => {
  it.each([401, 403, 404, 422])(
    "fails after one attempt on %i",
    async (status) => {
      const { client, calls, waits } = setup([jsonResponse(status, {})]);

      const error = await captureErpError(
        client.erpGet("/v1/clientes/C9001?x=1", okSchema),
      );

      expect(calls).toHaveLength(1);
      expect(waits).toEqual([]);
      expect(error.kind).toBe("http");
      expect(error.status).toBe(status);
      expect(error.attempts).toBe(1);
      expect(error.path).toBe("/v1/clientes/C9001");
    },
  );

  it("keeps the ERP requestId and no other body field", async () => {
    const { client } = setup([
      jsonResponse(404, {
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Fictitious detail text",
        instance: "/v1/clientes/C9001",
        requestId: "req-fake-0001",
      }),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes/C9001", okSchema),
    );

    expect(error.requestId).toBe("req-fake-0001");
    expect(JSON.stringify(error)).not.toContain("Fictitious detail text");
    expect(error.message).not.toContain("Fictitious detail text");
  });

  it.each([
    ["not JSON", new Response("Unauthorized", { status: 401 })],
    ["JSON without requestId", jsonResponse(401, { title: "Unauthorized" })],
  ])("has no requestId when the error body is %s", async (_label, response) => {
    const { client } = setup([response]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes", okSchema),
    );

    expect(error.status).toBe(401);
    expect(error.requestId).toBeUndefined();
  });
});

describe("erpGet response validation", () => {
  it("fails without retrying when a 200 body does not match the schema", async () => {
    const { client, calls, waits } = setup([jsonResponse(200, { ok: "yes" })]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes", okSchema),
    );

    expect(error.kind).toBe("invalid-response");
    expect(error.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("fails without retrying when a 200 body is not JSON", async () => {
    const { client, calls } = setup([new Response("<html>", { status: 200 })]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes", okSchema),
    );

    expect(error.kind).toBe("invalid-response");
    expect(calls).toHaveLength(1);
  });

  it("lists only field paths, without the Zod message or the received value", async () => {
    const invalidCnpj = "99-FAKE-CNPJ-99";
    const invalidPage = {
      ...customerPage,
      dados: [{ ...customerPage.dados[0], cnpj: invalidCnpj }],
    };
    const { client } = setup([jsonResponse(200, invalidPage)]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes", erpPageSchema(erpCustomerSchema)),
    );

    expect(error.issues).toEqual(["dados.0.cnpj"]);
    const serialized = `${error.message} ${JSON.stringify(error)}`;
    expect(serialized).not.toContain(invalidCnpj);
    expect(serialized).not.toContain("Invalid");
    expect(serialized).not.toContain("pattern");
  });
});

describe("ERP API key confidentiality", () => {
  const failures: [string, FetchStep[]][] = [
    ["a non-retryable status", [jsonResponse(401, { detail: "bad key" })]],
    ["an invalid response", [jsonResponse(200, { ok: false })]],
    [
      "exhausted retries with a network error that echoes the key",
      Array.from(
        { length: 5 },
        () => new TypeError(`fetch failed ${fakeApiKey}`),
      ),
    ],
  ];

  it.each(failures)(
    "keeps the key out of the error for %s",
    async (_label, steps) => {
      const { client } = setup(steps);

      const error = await captureErpError(
        client.erpGet("/v1/clientes", okSchema),
      );

      expect(error.message).not.toContain(fakeApiKey);
      expect(error.stack ?? "").not.toContain(fakeApiKey);
      expect(JSON.stringify(error)).not.toContain(fakeApiKey);
      expect(String(error)).not.toContain(fakeApiKey);
      expect(error.cause).toBeUndefined();
    },
  );

  it("keeps the key out of every retry log entry", async () => {
    const { client, logs } = setup([
      jsonResponse(429, {}),
      jsonResponse(503, {}),
      new TypeError(`fetch failed ${fakeApiKey}`),
      timeoutError(),
      jsonResponse(500, {}),
    ]);

    await captureErpError(client.erpGet("/v1/clientes", okSchema));

    expect(logs).toHaveLength(4);
    expect(JSON.stringify(logs)).not.toContain(fakeApiKey);
  });
});

// Values that stand for text the ERP may echo from the request. They must never
// reach the error message, its JSON form, its stack, or the logs.
const detailSentinel = "SENTINEL-detail-repeating-a-sent-value";
const instanceSentinel = "/v1/SENTINEL-instance";
const messageSentinel = "SENTINEL-mensagem-repeating-a-sent-value";
const sentinels = [detailSentinel, instanceSentinel, messageSentinel];

function problemResponse(
  status: number,
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return jsonResponse(
    status,
    {
      type: "https://erp.example.invalid/problems/generic",
      title: "Generic Problem",
      status,
      detail: detailSentinel,
      instance: instanceSentinel,
      requestId: "req-fake-0001",
      ...overrides,
    },
    { "content-type": "application/problem+json", ...headers },
  );
}

function everythingSerialized(error: ErpError) {
  return [
    error.message,
    error.stack ?? "",
    JSON.stringify(error),
    String(error),
  ].join("\n");
}

function expectNoSentinels(text: string) {
  for (const sentinel of sentinels) {
    expect(text).not.toContain(sentinel);
  }
}

const customerWithStatus = (status: string) => ({
  ...customerPage,
  dados: [{ ...customerPage.dados[0], status }],
});

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

const receivablePage = (status: string) => ({
  dados: [{ ...receivable, status }],
  pagina: 1,
  tamanho: 20,
  total: 1,
  totalPaginas: 1,
});

describe("erpGet closed status lists", () => {
  it.each([
    [
      "customer",
      "SUSPENSO",
      customerWithStatus("SUSPENSO"),
      erpPageSchema(erpCustomerSchema),
    ],
    [
      "receivable",
      "CANCELADO",
      receivablePage("CANCELADO"),
      erpPageSchema(erpReceivableSchema),
    ],
  ])(
    "fails without retrying on an undocumented %s status %s",
    async (_label, status, body, schema) => {
      const { client, calls, waits } = setup([jsonResponse(200, body)]);

      const error = await captureErpError(
        client.erpGet("/v1/registros?pagina=1", schema),
      );

      expect(error.kind).toBe("invalid-response");
      expect(error.status).toBe(200);
      expect(error.issues).toEqual(["dados.0.status"]);
      expect(calls).toHaveLength(1);
      expect(waits).toEqual([]);
      expect(everythingSerialized(error)).not.toContain(status);
    },
  );

  it.each(["PAGO", "EM_ABERTO", "VENCIDO"])(
    "returns a receivable whose status is the documented %s",
    async (status) => {
      const { client } = setup([jsonResponse(200, receivablePage(status))]);

      const result = await client.erpGet(
        "/v1/titulos",
        erpPageSchema(erpReceivableSchema),
      );

      expect(result.dados[0]?.status).toBe(status);
    },
  );
});

describe("erpGet response media type", () => {
  const body = JSON.stringify({ ok: true });
  const withoutContentType = () =>
    new Response(new TextEncoder().encode(body), { status: 200 });

  it("builds a response without any content-type for the cases below", () => {
    expect(withoutContentType().headers.get("content-type")).toBeNull();
  });

  it.each([
    [
      "text/plain",
      () => jsonResponse(200, { ok: true }, { "content-type": "text/plain" }),
    ],
    [
      "application/octet-stream",
      () =>
        jsonResponse(
          200,
          { ok: true },
          { "content-type": "application/octet-stream" },
        ),
    ],
    ["no content-type", withoutContentType],
  ])("reads and validates a 200 body served as %s", async (_label, make) => {
    const { client, calls } = setup([make()]);

    await expect(client.erpGet("/v1/clientes", okSchema)).resolves.toEqual({
      ok: true,
    });
    expect(calls).toHaveLength(1);
  });

  it("still fails as invalid-response when a body served as text/plain does not match", async () => {
    const { client, calls } = setup([
      jsonResponse(200, { ok: "yes" }, { "content-type": "text/plain" }),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes", okSchema),
    );

    expect(error.kind).toBe("invalid-response");
    expect(error.issues).toEqual(["ok"]);
    expect(calls).toHaveLength(1);
  });
});

describe("erpGet safe error details", () => {
  it("keeps title, type, requestId, and the erros campo list of a 400, and nothing else", async () => {
    const { client, calls } = setup([
      problemResponse(400, {
        type: "https://erp.example.invalid/problems/validation",
        title: "Bad Request",
        requestId: "req-fake-0400",
        erros: [
          { campo: "tamanho", mensagem: messageSentinel },
          { campo: "pagina", mensagem: messageSentinel },
        ],
      }),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes?tamanho=abc", okSchema),
    );

    expect(calls).toHaveLength(1);
    expect(error.kind).toBe("http");
    expect(error.status).toBe(400);
    expect(error.title).toBe("Bad Request");
    expect(error.type).toBe("https://erp.example.invalid/problems/validation");
    expect(error.requestId).toBe("req-fake-0400");
    expect(error.fields).toEqual(["tamanho", "pagina"]);
    expectNoSentinels(everythingSerialized(error));
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({
      kind: "http",
      status: 400,
      title: "Bad Request",
      requestId: "req-fake-0400",
      fields: ["tamanho", "pagina"],
    });
  });

  it("keeps only the string campo values of erros entries", async () => {
    const { client } = setup([
      problemResponse(400, {
        erros: [
          { campo: "uf", mensagem: messageSentinel },
          { mensagem: messageSentinel },
          { campo: 7, mensagem: messageSentinel },
          "tamanho",
          null,
        ],
      }),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes", okSchema),
    );

    expect(error.fields).toEqual(["uf"]);
    expectNoSentinels(everythingSerialized(error));
  });

  it("reads the real observed 404 served as application/problem+json", async () => {
    const { client, calls } = setup([
      problemResponse(404, {
        type: "https://erp.example.invalid/problems/not-found",
        title: "Not Found",
        requestId: "req-fake-0404",
      }),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes/C0000?x=1", okSchema),
    );

    expect(calls).toHaveLength(1);
    expect(error.kind).toBe("http");
    expect(error.status).toBe(404);
    expect(error.path).toBe("/v1/clientes/C0000");
    expect(error.title).toBe("Not Found");
    expect(error.type).toBe("https://erp.example.invalid/problems/not-found");
    expect(error.requestId).toBe("req-fake-0404");
    expect(error.fields).toBeUndefined();
    expectNoSentinels(everythingSerialized(error));
  });

  // Regression guard: passes immediately by design, because the client already
  // treats every 4xx except 429 as non-retryable and keeps only the safe fields.
  it("reads a 422 validation error without retrying and keeps only safe fields", async () => {
    const { client, calls, waits, logs } = setup([
      problemResponse(422, {
        type: "https://erp.example.invalid/problems/unprocessable",
        title: "Fictitious Unprocessable Entity",
        instance: `${instanceSentinel}?updatedSince=fictitious-value`,
        requestId: "req-fake-0422",
        erros: [{ campo: "updatedSince", mensagem: messageSentinel }],
      }),
    ]);

    const error = await captureErpError(
      client.erpGet("/v1/clientes?updatedSince=fictitious-value", okSchema),
    );

    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(error.kind).toBe("http");
    expect(error.status).toBe(422);
    expect(error.attempts).toBe(1);
    expect(error.path).toBe("/v1/clientes");
    expect(error.title).toBe("Fictitious Unprocessable Entity");
    expect(error.type).toBe(
      "https://erp.example.invalid/problems/unprocessable",
    );
    expect(error.requestId).toBe("req-fake-0422");
    expect(error.fields).toEqual(["updatedSince"]);
    expectNoSentinels(everythingSerialized(error));
    expect(JSON.stringify(error)).not.toContain("fictitious-value");
    expectNoSentinels(JSON.stringify(logs));
  });

  describe("after 5 attempts answered with 429 as application/problem+json", () => {
    const attempts = () =>
      Array.from({ length: 5 }, (_unused, index) =>
        problemResponse(429, {
          title: `Too Many Requests ${index + 1}`,
          requestId: `req-fake-000${index + 1}`,
        }),
      );

    it("fails with kind http, status 429, 5 attempts, and the 2, 4, 8, 16 s backoff", async () => {
      const { client, calls, waits } = setup(attempts());

      const error = await captureErpError(
        client.erpGet("/v1/clientes", okSchema),
      );

      expect(calls).toHaveLength(5);
      expect(waits).toEqual([2_000, 4_000, 8_000, 16_000]);
      expect(error.kind).toBe("http");
      expect(error.status).toBe(429);
      expect(error.attempts).toBe(5);
    });

    it("carries the safe fields of the last body only", async () => {
      const { client } = setup(attempts());

      const error = await captureErpError(
        client.erpGet("/v1/clientes", okSchema),
      );

      expect(error.title).toBe("Too Many Requests 5");
      expect(error.requestId).toBe("req-fake-0005");
      expectNoSentinels(everythingSerialized(error));
    });

    it("follows Retry-After on every retry and keeps body text out of the logs", async () => {
      const { client, waits, logs } = setup(
        Array.from({ length: 5 }, () =>
          problemResponse(429, {}, { "retry-after": "3" }),
        ),
      );

      const error = await captureErpError(
        client.erpGet("/v1/clientes", okSchema),
      );

      expect(error.attempts).toBe(5);
      expect(waits).toEqual([3_000, 3_000, 3_000, 3_000]);
      expect(logs).toHaveLength(4);
      expectNoSentinels(JSON.stringify(logs));
    });
  });

  it.each([
    ["not JSON", () => new Response("<html>nope</html>", { status: 400 })],
    ["empty", () => new Response(null, { status: 400 })],
    ["a JSON array", () => jsonResponse(400, [1, 2])],
    ["JSON null", () => new Response("null", { status: 400 })],
    [
      "JSON with fields of the wrong types",
      () =>
        jsonResponse(400, {
          title: 5,
          type: { nested: true },
          requestId: 123,
          erros: "tamanho",
        }),
    ],
  ])(
    "does not break or change the error kind when the error body is %s",
    async (_label, make) => {
      const { client, calls } = setup([make()]);

      const error = await captureErpError(
        client.erpGet("/v1/clientes", okSchema),
      );

      expect(calls).toHaveLength(1);
      expect(error.kind).toBe("http");
      expect(error.status).toBe(400);
      expect(error.attempts).toBe(1);
      expect(error.title).toBeUndefined();
      expect(error.type).toBeUndefined();
      expect(error.requestId).toBeUndefined();
      expect(error.fields).toBeUndefined();
    },
  );
});
