// Manual smoke check against the real ERP. Never imported by tests.
// Run with `pnpm erp:smoke`; see the README section "ERP smoke check".
import "dotenv/config";

// Dynamic imports keep `dotenv` ahead of the `env` singleton, which parses
// `process.env` when first imported.
const { env } = await import("../src/shared/config/env.js");
const { createErpClient } = await import("../src/shared/erp/erp-client.js");
const { runErpSmoke } = await import("../src/shared/erp/erp-smoke.js");

const client = createErpClient({
  baseUrl: env.ERP_API_URL,
  apiKey: env.ERP_API_KEY,
  timeoutMs: env.ERP_REQUEST_TIMEOUT_MS,
});

const ok = await runErpSmoke({
  client,
  now: Date.now,
  print: (line) => {
    console.log(line);
  },
});

if (!ok) {
  process.exitCode = 1;
}
