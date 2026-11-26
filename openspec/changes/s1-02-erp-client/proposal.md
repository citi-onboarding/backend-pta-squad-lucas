## Why

The ERP is the system of record for DistriLux customers, products, receivables, and
orders. It enforces a per-minute call quota shared by the whole squad, is occasionally
unavailable, may be slow on its first call, and is poorly documented. Before any
synchronization can be built (F02 part 3), the backend needs one shared, safe way to
read from the ERP: it must wait and retry on transient failures (RN-15), validate every
response before use, keep the API key on the backend only (RN-14), and present ERP
amounts, which arrive in integer cents, as Brazilian reais (RN-13).

## What Changes

- Add `ERP_API_URL`, `ERP_API_KEY`, and `ERP_REQUEST_TIMEOUT_MS` to the validated
  environment. The backend refuses to start when the URL or key is missing or invalid.
  `.env.example`, CI, Docker Compose, and test setup receive fake, non-secret values.
- Add a single ERP read client (`erpGet`) that:
  - sends the API key in the `X-Api-Key` request header;
  - retries on 429, 5xx, network failures, and timeouts, up to 5 attempts in total;
  - waits according to `Retry-After` (seconds or HTTP-date, capped) or exponential
    backoff (2, 4, 8, 16 seconds);
  - fails immediately on any other non-success status;
  - validates the response body against a Zod schema before returning it;
  - raises a typed `ErpError` that never contains the API key or payload data.
- Add Zod schemas for ERP customer (`cliente`), product (`produto`), and receivable
  (`titulo`) records and for the paginated list envelope, using the confirmed ERP field
  names in Portuguese.
- Add `formatCents`, which formats integer cents as a pt-BR currency string.
- Extend log redaction so the ERP key header can never be written to logs.
- Record confirmed facts and pending items about the ERP API in ADR 0002.

### Non-goals

- `POST /v1/pedidos` or any other write to the ERP.
- Synchronization jobs, persistence of ERP data, or `SyncRun` handling (F02 part 3).
- Helpers that iterate pages or build `atualizadoDesde` queries (F02 part 3).
- Mapping ERP payloads to the database model of ADR-0001.
- A local rate limiter or cross-process quota budgeting.
- New HTTP endpoints, OpenAPI changes, or exposure of ERP data to the web or mobile app.
- Calling the real ERP from any automated test.

## Capabilities

### New Capabilities

- `erp-integration`: Configuration, resilient reading, response validation, secret
  protection, and money formatting for data obtained from the DistriLux ERP.

### Modified Capabilities

- `backend-foundation`: The "Safe observability" requirement also redacts the ERP API
  key header.

## Impact

- **Business:** Enables reliable ERP reads that survive quota limits and outages without
  losing or duplicating data, which is the precondition for synchronization.
- **API:** None. No endpoint is added or changed; `openapi.json` is unchanged.
- **Database migration:** None.
- **Security:** Introduces a shared squad secret (`ERP_API_KEY`). It is read only by the
  backend, never logged, never placed in errors, and never committed (fake values only).
- **Observability:** One warning log line per retry, containing the path without query
  string, status or failure kind, attempt number, and wait time.
- **Runtime and delivery:** Two new required environment variables. CI, Docker Compose,
  the container test script, the shared Vitest setup, and the test fixtures that build a
  full environment object must provide fake values, so `pnpm test:container` applies.
- **Quota:** Reading every customer, product, and receivable with page size 20 costs 33
  calls of the shared squad quota; F02 part 3 must plan around it.
- **Dependencies:** None added. Native `fetch` and `AbortSignal.timeout` on Node 22.
- **Code:** `src/shared/config/env.ts`, `src/shared/logging/logger.ts`, and new files
  under `src/shared/erp/`.
- **Documentation:** ADR `docs/adr/0002-api-do-erp.md` (named after the existing
  `0001-modelo-de-dados.md` precedent) and `docs/changes/s1-02-erp-client.md`.
