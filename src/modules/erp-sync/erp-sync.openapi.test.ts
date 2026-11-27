import { describe, expect, it } from "vitest";

import { createOpenApiDocument } from "../../shared/http/openapi.js";
import "./erp-sync.openapi.js";

describe("erp sync OpenAPI contract", () => {
  it("documents the status route", () => {
    const document = createOpenApiDocument();

    const operation = document.paths?.["/api/v1/sync/status"]?.get;
    expect(operation).toBeDefined();
    expect(operation?.responses?.["200"]).toBeDefined();
  });

  it("documents the run list with its limit parameter, a 400, and a 401 answer", () => {
    const document = createOpenApiDocument();

    const operation = document.paths?.["/api/v1/sync/runs"]?.get;
    expect(operation).toBeDefined();
    expect(JSON.stringify(operation?.parameters)).toContain("limit");
    expect(operation?.responses?.["200"]).toBeDefined();
    expect(operation?.responses?.["400"]).toBeDefined();
    expect(operation?.responses?.["401"]).toBeDefined();
  });

  it("documents the manual run with 202, 401, and 409", () => {
    const document = createOpenApiDocument();

    const operation = document.paths?.["/api/v1/sync/run"]?.post;
    expect(operation).toBeDefined();
    expect(operation?.responses?.["202"]).toBeDefined();
    expect(operation?.responses?.["401"]).toBeDefined();
    expect(operation?.responses?.["409"]).toBeDefined();
  });

  it("lists every run result, including RATE_LIMITED", () => {
    const serialized = JSON.stringify(createOpenApiDocument());

    for (const result of ["SUCCESS", "PARTIAL", "FAILED", "RATE_LIMITED"]) {
      expect(serialized).toContain(`"${result}"`);
    }
  });
});
