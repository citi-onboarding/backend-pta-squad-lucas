import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

function captureOutput() {
  const captured = { output: "" };
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      captured.output += chunk.toString();
      callback();
    },
  });
  return { captured, destination };
}

describe("createLogger", () => {
  it("redacts credentials", async () => {
    const { captured, destination } = captureOutput();
    const logger = createLogger({ LOG_LEVEL: "info" }, destination);

    logger.info({ password: "secret", token: "token-value" }, "credentials");
    await new Promise((resolve) => setImmediate(resolve));

    expect(captured.output).not.toContain("secret");
    expect(captured.output).not.toContain("token-value");
    expect(captured.output).toContain("[REDACTED]");
  });

  it("redacts the ERP API key header", async () => {
    const fakeErpApiKey = "fake-erp-key-must-not-leak";
    const { captured, destination } = captureOutput();
    const logger = createLogger({ LOG_LEVEL: "info" }, destination);

    logger.info(
      { req: { headers: { "x-api-key": fakeErpApiKey } } },
      "incoming",
    );
    logger.info({ headers: { "x-api-key": fakeErpApiKey } }, "outgoing");
    await new Promise((resolve) => setImmediate(resolve));

    expect(captured.output).not.toContain(fakeErpApiKey);
    expect(captured.output.match(/\[REDACTED\]/g)).toHaveLength(2);
  });
});
