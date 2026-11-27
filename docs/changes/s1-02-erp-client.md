---
change_id: s1-02-erp-client
date: 2026-11-26
status: in-progress
owners: []
tags: [erp, integration, resilience, backend]
related_adrs: [ADR-0002]
openspec_change: openspec/changes/s1-02-erp-client/
---

# ERP read client

## Objective

Give the backend one shared, safe way to read customers, products, and receivables from
the DistriLux ERP: configured at startup, resilient to quota limits and outages,
validated before use, without exposing the shared API key, and able to present ERP
amounts in cents as Brazilian reais. No module consumes the client yet; synchronization
is F02 part 3.

## Change made

- **Environment.** `ERP_API_URL` (absolute `https`, no trailing slash), `ERP_API_KEY`
  (non-empty), and `ERP_REQUEST_TIMEOUT_MS` (positive integer up to 120000, default 60000) are
  validated at startup. Fake, non-secret values were added to the test setup, CI, Docker
  Compose, the container test script, and `.env.example`.
- **Client.** `createErpClient` in `src/shared/erp/erp-client.ts` exposes
  `erpGet(path, schema)`. `fetch`, sleep, clock, and logger are injected. It sends the key
  in the `x-api-key` header, retries up to 5 attempts in total on `429`, any `5xx`, a
  missing response, or a timeout, and fails immediately on any other non-success status.
  The wait follows a valid `Retry-After` (seconds or HTTP date, capped at 60 seconds) or
  backs off 2, 4, 8, and 16 seconds.
- **Errors.** `ErpError` carries only safe facts: kind, status, path without query
  string, attempts, `title`, `type`, `requestId`, the names of invalid fields, and, for an
  invalid response, the field paths. It never carries the key, headers, a cause, `detail`,
  `instance`, or `erros[].mensagem`.
- **Schemas.** `erp-schemas.ts` validates customers, products, receivables, and the list
  envelope, following the confirmed ERP fields. Extra fields are accepted; closed status
  lists are enforced.
- **Cents.** `formatCents` in `money.ts` formats integer cents as pt-BR reais.
- **Logging.** The ERP key header was added to the redaction list.
- **Smoke check.** `pnpm erp:smoke` (`scripts/erp-smoke.ts`, logic in
  `src/shared/erp/erp-smoke.ts`) makes one real read per resource with page size 1 and
  prints only timing and counts.
- **Decision record.** ADR 0002 records confirmed versus documented ERP facts, the retry
  policy, the timeout, the read cost, and the items not verified.

## Resulting behavior

- The backend refuses to start when an ERP setting is missing or invalid; the error names
  the setting and never prints the key value.
- A successful read returns validated data after one attempt.
- `429`, `5xx`, a network failure, or a timeout is retried, with at most 5 attempts; after
  the last one the read fails with an ERP error that states the last failure and 5
  attempts. Each retry logs one warning with only the path without query string, the
  status or kind, the attempt number, and the wait.
- A path that does not start with `/` is rejected with a `TypeError` before any request, so
  the request target cannot change the host of the base URL; the message never contains
  the path.
- A request timeout above 120000 ms makes startup fail, naming `ERP_REQUEST_TIMEOUT_MS`.
- Any other non-success status, such as `401`, `403`, `404`, or `422`, fails after one
  attempt without waiting.
- A `200` body that does not match the schema fails without retrying, listing only field
  paths such as `dados.0.cnpj`.
- Error bodies are read as JSON whatever their media type, and only `title`, `type`,
  `requestId`, and field names are kept.
- `pnpm erp:smoke` prints one line per resource and stops at the first failure.

## Impact

- No HTTP endpoint, OpenAPI, or database change. Nothing in the composition root uses the
  client yet.
- Every environment now needs `ERP_API_URL` and `ERP_API_KEY`; without them the backend
  does not start. Developers must add both to their own `.env`.
- Retries consume the call quota shared by the whole squad. Reading everything costs 33
  calls with page size 20 and 15 with page size 50; F02 part 3 should use 50 and confirm
  that the server accepts it.
- Upper bound for one read: about 9 minutes, computed as 5 attempts of up to 60 seconds
  (300 s) plus 4 waits of up to 60 seconds, the `Retry-After` cap (240 s). With only
  timeouts and the default backoff it is about 5.5 minutes. This is fine for background
  synchronization only. The client has no cancellation or per-call deadline (fixed timeout
  per client, default sleep not cancellable); F02 part 3 must use a separate client with a
  shorter timeout for interactive use and handle shutdown (ADR 0002).
- Receivables issued before 2026-10-01 are not available from the ERP (documented).
- Not verified against a real ERP, and recorded as such in ADR 0002: a real `429`, a real
  `5xx`, the `Retry-After` format, and the per-minute limit. The first-call duration has
  one observation (643 ms) with no evident slow start; the 60000 ms timeout stays as an
  initial value.

## Validations executed

Run on Windows on 2026-11-26, after the review follow-ups (timeout ceiling and path check), with the working tree line endings as
checked out (`core.autocrlf=true`). The real ERP was called only by the developer, once,
through `pnpm erp:smoke`.

| Command                                                             | Result                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narrowest tests (`src/shared/erp`, `env.test.ts`, `logger.test.ts`) | 129 passed in 7 files                                                                                                                                                                                                                                                                    |
| `pnpm typecheck`                                                    | Passed                                                                                                                                                                                                                                                                                   |
| `pnpm lint`                                                         | Passed, zero errors                                                                                                                                                                                                                                                                      |
| `pnpm build`                                                        | Passed                                                                                                                                                                                                                                                                                   |
| `openspec validate s1-02-erp-client --strict`                       | Valid                                                                                                                                                                                                                                                                                    |
| `pnpm spec:validate`                                                | Passed                                                                                                                                                                                                                                                                                   |
| `pnpm skills:check`                                                 | Passed                                                                                                                                                                                                                                                                                   |
| `pnpm test`                                                         | 167 passed, 3 failed: the architecture tests in `tests/architecture/boundaries.test.ts`, which fail on Windows only (fixture paths) and pass in CI (Linux). They failed before this change.                                                                                              |
| `pnpm test:architecture`                                            | The same 3 failures                                                                                                                                                                                                                                                                      |
| `pnpm openapi:check`                                                | Failed only because `openapi.json` has CRLF line endings in the Windows working tree; its content equals the generated document once CR is ignored. The file is not part of this change.                                                                                                 |
| `pnpm test:coverage`                                                | Failed only because of the 3 architecture tests. Excluding them (`vitest run --coverage --exclude '**/*.integration.test.ts' --exclude 'tests/architecture/**'`): 167 passed in 16 files, thresholds met: statements 98.19%, branches 96.36%, functions 97.43% (38 of 39), lines 98.12%. |
| `pnpm format:check`                                                 | Failed on 33 files not touched by this change; all differ from Prettier output only by CRLF line endings. The files of this change pass Prettier.                                                                                                                                        |
| `pnpm test:integration`                                             | Passed: 7 files, 55 tests (Testcontainers started its own PostgreSQL).                                                                                                                                                                                                                   |
| `pnpm test:container`                                               | Passed: both images built, migrations `20260813000000_initial` and `20261125115933_s1_01_data_model` applied, and the API container started with the fake ERP settings (`Production container smoke test passed.`).                                                                      |

## Related artifacts

- Proposal: `openspec/changes/s1-02-erp-client/proposal.md`
- Specification: `openspec/changes/s1-02-erp-client/specs/erp-integration/spec.md`, plus a
  delta in `specs/backend-foundation/spec.md`
- Design: `openspec/changes/s1-02-erp-client/design.md`
- Tasks: `openspec/changes/s1-02-erp-client/tasks.md`
- ADR: `docs/adr/0002-erp-api-access.md` (proposed)

## Usage

- Add `ERP_API_URL`, `ERP_API_KEY`, and optionally `ERP_REQUEST_TIMEOUT_MS` to the ignored
  `.env` file, next to the other required variables.
- Inside the backend, create the client once with `createErpClient` and read with
  `erpGet(path, schema)`, using the schemas of `erp-schemas.ts`.
- To check the real ERP, run `pnpm erp:smoke` and share only the printed lines. See the
  README section "ERP smoke check".

## Implementation notes

- **Function coverage.** The production defaults of the injected dependencies (global
  `fetch` wrapper, timer-based sleep, no-op logger) were first uncovered, which put the
  global function coverage at 87.17%, below the 90% threshold. Regression-guard tests in
  `src/shared/erp/erp-client-defaults.test.ts` now cover them and pass immediately by
  design. The threshold was not lowered. The only uncovered function left is in
  `create-database.ts`, which integration tests cover.
- **Windows only.** The 3 architecture test failures, the CRLF-only `format:check` and
  `openapi:check` failures, and the `core.autocrlf=true` setting are properties of the
  Windows checkout, not of this change.
- **Single observations.** The `401` being answered before parameter validation and the
  first-call duration rest on one observation each. The 50-record page size is documented
  but was not confirmed against the server.
- **Out of scope.** Page iteration, incremental queries, wiring into the composition root,
  and mapping ERP payloads to the database model belong to F02 part 3.
