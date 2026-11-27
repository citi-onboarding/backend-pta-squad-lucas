import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createErpClient, ERP_API_KEY_HEADER } from "./erp-client.js";

// Regression guards for the production defaults of the injected dependencies
// (global fetch, timer-based sleep, no-op logger). They pass immediately by
// design: the defaults already behave as specified. Only the global fetch is
// stubbed; no real network is used.

const okSchema = z.object({ ok: z.literal(true) });
const fakeApiKey = "fake-erp-key-for-tests";

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

function createDefaultClient() {
  return createErpClient({
    baseUrl: "https://erp.example.invalid",
    apiKey: fakeApiKey,
    timeoutMs: 60_000,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createErpClient default dependencies", () => {
  it("reads through the global fetch with the key header when no fetch is injected", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(okResponse()));
    vi.stubGlobal("fetch", fetchStub);

    const data = await createDefaultClient().erpGet(
      "/v1/clientes?pagina=1&tamanho=1",
      okSchema,
    );

    expect(data).toEqual({ ok: true });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://erp.example.invalid/v1/clientes?pagina=1&tamanho=1",
    );
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ [ERP_API_KEY_HEADER]: fakeApiKey });
  });

  it("waits with the default timer-based sleep and tolerates the no-op logger on a retry", async () => {
    vi.useFakeTimers();
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchStub);

    const pending = createDefaultClient().erpGet("/v1/clientes", okSchema);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
