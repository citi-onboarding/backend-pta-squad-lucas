import { describe, expect, it } from "vitest";

import { parseEnvironment } from "./env.js";

const fakeErpApiKey = "fake-erp-key-must-not-leak";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/test",
  CORS_ORIGINS: "http://localhost:5173, https://example.com ",
  ERP_API_URL: "https://erp.example.invalid",
  ERP_API_KEY: fakeErpApiKey,
};

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the action to throw.");
}

describe("parseEnvironment", () => {
  it("parses defaults and a comma-separated CORS allowlist", () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.SERVER_PORT).toBe(3001);
    expect(environment.corsOrigins).toEqual([
      "http://localhost:5173",
      "https://example.com",
    ]);
  });

  it("rejects invalid database URLs", () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        DATABASE_URL: "mysql://localhost/test",
      }),
    ).toThrow();
  });

  it("rejects an empty CORS allowlist", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, CORS_ORIGINS: " , " }),
    ).toThrow("CORS_ORIGINS must contain at least one origin.");
  });
});

describe("parseEnvironment ERP configuration", () => {
  it("accepts valid ERP settings and defaults the request timeout to 60000 ms", () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.ERP_API_URL).toBe("https://erp.example.invalid");
    expect(environment.ERP_API_KEY).toBe(fakeErpApiKey);
    expect(environment.ERP_REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it("accepts an explicit request timeout", () => {
    const environment = parseEnvironment({
      ...validEnvironment,
      ERP_REQUEST_TIMEOUT_MS: "30000",
    });

    expect(environment.ERP_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it("rejects a missing ERP base URL", () => {
    const withoutUrl = { ...validEnvironment, ERP_API_URL: undefined };

    expect(() => parseEnvironment(withoutUrl)).toThrow(/ERP_API_URL/);
  });

  it.each([
    ["an http URL", "http://erp.example.invalid"],
    ["a URL with a trailing slash", "https://erp.example.invalid/"],
    ["a relative value", "erp.example.invalid"],
  ])("rejects %s as ERP base URL", (_label, erpApiUrl) => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, ERP_API_URL: erpApiUrl }),
    ).toThrow(/ERP_API_URL/);
  });

  it("rejects a missing ERP API key", () => {
    const withoutKey = { ...validEnvironment, ERP_API_KEY: undefined };

    expect(() => parseEnvironment(withoutKey)).toThrow(/ERP_API_KEY/);
  });

  it("rejects an empty ERP API key", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, ERP_API_KEY: "" }),
    ).toThrow(/ERP_API_KEY/);
  });

  it.each(["0", "-1", "1.5", "abc"])(
    "rejects %s as request timeout",
    (timeout) => {
      expect(() =>
        parseEnvironment({
          ...validEnvironment,
          ERP_REQUEST_TIMEOUT_MS: timeout,
        }),
      ).toThrow(/ERP_REQUEST_TIMEOUT_MS/);
    },
  );

  it.each(["120001", "300000", "1e6"])(
    "rejects a request timeout above the 120000 ms ceiling (%s)",
    (timeout) => {
      expect(() =>
        parseEnvironment({
          ...validEnvironment,
          ERP_REQUEST_TIMEOUT_MS: timeout,
        }),
      ).toThrow(/ERP_REQUEST_TIMEOUT_MS/);
    },
  );

  it("accepts a request timeout of exactly 120000 ms", () => {
    const environment = parseEnvironment({
      ...validEnvironment,
      ERP_REQUEST_TIMEOUT_MS: "120000",
    });

    expect(environment.ERP_REQUEST_TIMEOUT_MS).toBe(120_000);
  });

  it.each([
    ["an invalid base URL", { ERP_API_URL: "http://erp.example.invalid" }],
    ["an invalid timeout", { ERP_REQUEST_TIMEOUT_MS: "-1" }],
  ])(
    "does not echo the ERP API key when startup fails because of %s",
    (_label, override) => {
      const error = captureError(() =>
        parseEnvironment({ ...validEnvironment, ...override }),
      );

      expect(String(error)).not.toContain(fakeErpApiKey);
      expect(JSON.stringify(error)).not.toContain(fakeErpApiKey);
      expect((error as Error).stack ?? "").not.toContain(fakeErpApiKey);
    },
  );
});
