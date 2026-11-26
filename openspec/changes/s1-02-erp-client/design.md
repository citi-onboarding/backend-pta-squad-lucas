## Context

See `proposal.md` (Why) for motivation and `specs/erp-integration/spec.md` for the
requirements and the confirmed and pending ERP API facts.

Current state:

- `src/shared/config/env.ts` validates the environment with Zod and exports a parsed
  `env` singleton at import time. Tests import `parseEnvironment` instead.
- `src/shared/logging/logger.ts` builds a pino logger with a fixed redaction list.
- `tests/setup-env.ts`, `.github/workflows/ci.yml`, `docker-compose.yml`, and
  `scripts/test-container.mjs` provide environment values for tests, CI, and containers.
- Nothing in the backend talks to the ERP yet. No module consumes ERP data in this change.

Constraints: `src/shared` must not import `src/modules` or `src/app`; external
dependencies are injected; no new runtime dependencies; the real ERP is never called by
automated tests. The spec classifies every ERP fact. Confirmed by real responses: the
base URL, the key header (P1), the three list reads with their envelope (P3), the record
fields (P2), and the `404` body. Documented in the Swagger only: the route list, the
customer and receivable status lists (P2-status), the query parameters of the three
lists (P4), the `Problema` error body (P5 shape), and an `application/problem+json`
`429` (part of P6). Also confirmed by real responses: the `401` body (key checked before
parameter validation, one observation) and the `422` validation body, whose
`erros[].campo` is a URL parameter name (P5). Documented page size limits (`tamanho` 1 to 50, `pagina` minimum 1) are not verified
against the server. Still pending, deferred to ADR 0002: real `429` and `5xx` bodies
(P5), and the `Retry-After` format and the per-minute limit (P6). The cold-start
duration (P7) has a single observation with no evident slow start (643 ms for the first
call, 250 to 344 ms for the next two; one round, so it is not conclusive).

## Goals / Non-Goals

**Goals:**

- A small ERP client in `src/shared/erp/` that every future module can receive by
  injection, fully testable with fake `fetch`, fake `sleep`, fake clock, and a captured
  logger.
- Every pending ERP fact is isolated in one named place, so the Stage B update is a
  local edit plus its tests.

**Non-Goals:**

- Wiring the client into the composition root (`src/app` or `src/server.ts`): there is
  no consumer yet. F02 part 3 wires it.
- Page iteration and incremental query builders (F02 part 3; P4 still pending). The
  list envelope is validated, but nothing here walks pages.

## Decisions

### D-1: Factory with injected dependencies instead of a module-level function

`src/shared/erp/erp-client.ts` exports `createErpClient(options)` returning an object
with `erpGet(path, schema)`. Options: `baseUrl`, `apiKey`, `timeoutMs`, and optional
`fetch`, `sleep`, `now`, and `logger` (defaults: global `fetch`, a `setTimeout`-based
sleep, `Date.now`, and a no-op logger).

- Rejected: the task example, which reads the `env` singleton and global `fetch` inside
  `erpGet`. It makes tests depend on `process.env` at import time and violates the
  repository's dependency-injection rule.
- Rejected: recursion over `attempt` as in the example. A loop keeps the attempt counter,
  the last failure, and the 5-attempt limit in one visible place.

### D-2: Retry policy (pending decisions D1–D4 of the task)

- Retryable: `429`, any `5xx`, a `fetch` rejection (no response), and a timeout.
- Non-retryable: every other non-2xx status, that is, any `4xx` except `429` (fails after
  one attempt; the real ERP answers an invalid query parameter with `422`, not `400`,
  and the rule does not depend on which `4xx` it is) and an
  invalid-response failure on `200` (retrying returns the same body and wastes quota).
- At most 5 attempts in total. Backoff waits 2, 4, 8, and 16 seconds (worst case 30 s of
  waiting). No jitter: a single backend process reads the ERP, so synchronized retries
  across clients are not a concern yet.
- Timeout: `AbortSignal.timeout(timeoutMs)` covers both the request and the body read.
  `timeoutMs` comes from `ERP_REQUEST_TIMEOUT_MS`, default 60000 — an initial value.
  A single smoke round (P7, 2026-11-26) took 643 ms for the first call and 250 to 344 ms
  for the next two, so no slow cold start was evident; the default stays and is revisited
  if a later round shows a slow first call.
- Rejected: failing immediately on network errors. The ERP is known to drop and to be
  slow on a cold start, which is exactly the case RN-15 covers.
- Only `GET` is retried. Reads are idempotent, so retrying cannot duplicate data (RN-15).

### D-3: `Retry-After` parsing

Accept a non-negative integer number of seconds (`/^\d+$/`) or an HTTP date parsed with
`Date.parse` and compared against the injected `now()`. The result is capped at 60
seconds. Missing, unparseable, negative, or past values fall back to the backoff. `0` is
a valid instruction to retry immediately.

- Rejected: `Number(header) || 2 ** attempt` from the task example: it treats an HTTP
  date as invalid and treats `0` as missing, and it has no upper bound, so a hostile or
  buggy header could stall the backend for hours.

### D-4: Waiting is injected, not faked globally

Tests pass a `sleep` fake that records the requested milliseconds and resolves
immediately, and a `now` fake for HTTP-date cases.

- Rejected: Vitest fake timers. They require interleaving `advanceTimersByTimeAsync`
  with promise resolution and couple tests to the call order of timers; the injected fake
  asserts the waits directly.

### D-5: `ErpError` carries only safe, structured facts

`src/shared/erp/erp-error.ts` defines `ErpError extends Error` with:
`kind` (`http`, `network`, `timeout`, `invalid-response`), `status` (when a response
exists), `path` (without query string), `attempts`, optional `requestId`, and, for
`invalid-response`, `issues`: an array of strings built only from each Zod issue's
`path` joined with `.` (such as `dados.0.cnpj`). The Zod `message`, `code`, `input`, and
any received value are discarded, because Zod messages can quote received values. The message is built from these fields only, for example
`ERP GET /v1/clientes failed with status 503 after 5 attempts`.

- No `cause` is attached: a `fetch` rejection or a `ZodError` can carry request
  details or payload values. `toJSON` returns the same safe fields.
- The query string is dropped from `path` because filters such as `uf` or future
  identifiers may be business data.
- On any HTTP failure (non-retryable, or the last of 5 attempts) the error body is read
  best-effort and parsed as JSON regardless of `content-type`, because the ERP documents
  error bodies as `application/problem+json`. Only these documented or observed fields
  are copied, each only when present with the expected type: `title`, `type`,
  `requestId` (observed on `401`, `404`, and `422`, not in the `Problema` schema), and
  `fields`, the list of `erros[].campo` strings (on a `422`, the names of invalid URL
  parameters). `detail`, `instance`, and `erros[].mensagem` are dropped because they
  may repeat values sent in the request; observed `401` and `422` bodies confirm it,
  since `instance` carries the full path with the query string. Body reading never changes the
  error kind or status. `toJSON` and the message include only the safe fields; the
  message stays built from path, status, and attempts.
- Rejected: requiring `content-type: application/json` before parsing. Documented error
  bodies would be ignored, and a successful body with an unexpected media type would be
  rejected for no data-related reason.
- Rejected: keeping `detail` because it helps debugging. The `Problema` schema allows it
  to echo request values, and `requestId` already lets the ERP team trace the call.
- Rejected: letting `ZodError` propagate (it embeds received values) and keeping the raw
  response body (it may contain personal data).

### D-6: Key confidentiality in depth

1. The key is sent only in the header named by `ERP_API_KEY_HEADER`, a single exported
   constant with the value `x-api-key` (confirmed P1; written in lower case because
   header names are case-insensitive and Node normalizes them to lower case).
2. `ErpError` never stores headers, URLs with credentials, or causes (D-5).
3. Retry logs use a fixed object `{ path, status | kind, attempt, waitMs }`.
4. `createLogger` redaction adds the ERP key header for incoming request headers and for
   any logged `headers` object, as defense in depth.
5. Tests assert the fake key is absent from `message`, `stack`, `JSON.stringify(error)`,
   and every captured log line.

### D-7: Environment

`ERP_API_URL`: Zod URL restricted to the `https` protocol and refined to reject a
trailing slash. `ERP_API_KEY`: `z.string().min(1)`. `ERP_REQUEST_TIMEOUT_MS`:
`z.coerce.number().int().positive().default(60000)`. Zod issue messages name the path
(the variable) and never echo the received value for these fields.

Where the new required variables must be provided, with non-secret fake values
(`https://erp.example.invalid` and `fake-erp-key-for-tests`):

- `tests/setup-env.ts`: already the `setupFiles` of both `vitest.config.ts` and
  `vitest.integration.config.ts`, so it runs before any test file imports `env.ts`. Add
  `ERP_API_URL` and `ERP_API_KEY` with `??=`, matching the existing entries. This covers
  every test that imports the `env` singleton directly or indirectly.
- `src/shared/config/env.test.ts`: its `validEnvironment` fixture is passed to
  `parseEnvironment` explicitly and does not read `process.env`; add the fake ERP values.
- `src/app/create-app.test.ts` and
  `src/modules/example-items/example-items.integration.test.ts`: both build a full
  `Environment` object literal, which stops type-checking once the type gains the ERP
  fields; add the fake values. Narrowing `createApp` to `Pick<Environment, …>` is a
  refactor outside this change.
- `.github/workflows/ci.yml`: add both variables to the job-level `env`, matching the
  existing `DATABASE_URL` and `CORS_ORIGINS`. Tests would already pass through the
  Vitest setup; the explicit entries keep CI self-documenting and cover any future step
  that starts the server.
- `docker-compose.yml` (`api` service) and `scripts/test-container.mjs` (API container):
  add both variables so the container still starts. The migration container does not load
  `env.ts` and needs nothing.

`.env.example` gets the real public base URL and a placeholder key
(`replace-with-squad-erp-key`); the real key lives only in each developer's untracked
`.env` and is never used by automated tests, CI, or containers.

### D-8: Schemas follow the confirmed ERP contract

`src/shared/erp/erp-schemas.ts` defines, with Zod loose objects (unknown fields
accepted):

- `centsSchema`: `z.number().int()` restricted to the safe integer range;
- `erpDateSchema`: `z.iso.date()` (`YYYY-MM-DD`);
- `erpDateTimeSchema`: `z.iso.datetime({ offset: true })`, because `atualizadoEm` carries
  a UTC offset such as `-03:00`;
- `erpCustomerSchema`: all confirmed customer fields; `cnpj` as `/^\d{14}$/`; `status`
  as the enum `ATIVO | BLOQUEADO | INATIVO` (documented closed list); `segmento` as a
  free, non-empty string;
- `erpProductSchema`: all confirmed product fields; `ativo` as a boolean; `categoria`
  and `unidade` as free, non-empty strings;
- `erpReceivableSchema`: all confirmed receivable fields; `numero` and `pedidoErp` as
  integers; `pagamento` as `erpDateSchema.nullable()`; `status` as the enum
  `PAGO | EM_ABERTO | VENCIDO` documented in the `Titulo` schema (P2-status);
- `erpPageSchema(itemSchema)`: the list envelope with `dados` (an array of
  `itemSchema`) and the integer paging fields `pagina`, `tamanho`, `total`, and
  `totalPaginas`.

Every observed field is required: the confirmed responses always carried them, and a
required field that later turns out optional fails loudly instead of producing silent
`undefined` values. Free-text fields (`segmento`, `categoria`, `unidade`) stay strings
because the observed values are samples, not a closed list.

The schemas do not check paging consistency (for example `pagina <= totalPaginas`) or
cross-record rules (one `pedidoErp` with several `parcela`): neither is an ERP contract
we have confirmed, and both belong to the synchronization logic.

- Rejected: reusing the ADR-0001 database names (`erpId`, `amountCents`). Those describe
  our storage, not the ERP contract, and mapping belongs to F02 part 3.
- Rejected: closed enums for `segmento`, `categoria`, and `unidade` from the observed
  samples; the documentation gives no closed list, and a new value would break every
  read.
- Customer and receivable `status` are closed enums because the ERP documents closed
  lists. An undocumented value fails the read as an invalid response listing the
  `status` path, so a contract change is noticed instead of reaching synchronization
  silently.
- Response validation never checks `content-type`; the body is parsed as JSON and
  validated by the schema.

### D-11: Test data is invented

Tests use invented records (for example customer `C9001`, CNPJ `12345678000100`,
fictitious names such as `Fictitious Distributor Ltda`) that follow the confirmed
shapes. CNPJ check digits are not validated, so fake digits are enough. No real ERP record is
copied into the repository.

### D-9: `formatCents`

`src/shared/erp/money.ts` uses `Intl.NumberFormat("pt-BR", { style: "currency",
currency: "BRL" })` on `cents / 100` after checking `Number.isSafeInteger`. The output
keeps the locale's non-breaking space after `R$`; tests compare against the exact
string. Division by 100 is exact enough for display of safe integers; no arithmetic is
performed on the formatted value.

### D-10: Manual smoke check outside the suite (Stage B)

A script `scripts/erp-smoke.ts` (run with `pnpm erp:smoke`) loads `.env` through
`dotenv`, then imports the validated `env` singleton with a dynamic `import()` so that
`dotenv` runs first, and builds the client with `createErpClient`. It makes one read per
resource with page size 1 (3 calls of the shared quota), through the real record schemas,
and prints only the resource, elapsed milliseconds (feeds P7), `dados` length, `total`,
and `totalPaginas`. It stops at the first failure, to spare the shared quota, and then
prints only what `ErpError` exposes safely. The testable logic (`runErpSmoke`, with the
client, clock, and printer injected) lives in `src/shared/erp/erp-smoke.ts` and is tested
with a fake `fetch`; the script itself is a thin entry point, never imported by tests, and
never run against the real ERP by automated tests or by the assistant. No new dependency:
`dotenv` and `tsx` are already present.

## Risks / Trade-offs

- [Pending or documented-only ERP facts (P4, P5, P6, P7) turn out different] → Each one
  lives in one constant, schema field, or error-body field list; Stage B updates the spec
  first, then tests and code.
- [The ERP adds a receivable status beyond `PAGO`, `EM_ABERTO`, `VENCIDO`] → Every read of
  `/v1/titulos` containing it fails as an invalid response naming the `status` path
  until the spec and enum are updated. Accepted: the list is documented as closed.
- [A field observed as always present is optional for some records] → The read fails
  with an invalid-response error listing the field path; the schema is relaxed after
  updating the spec.
- [Receivables issued before 2026-10-01 are not available from the ERP (documented)] →
  Out of scope for this change, which only reads; recorded in ADR 0002 so F02 part 3 and
  any dashboard history do not assume older receivables exist.
- [Full read costs 33 calls with page size 20] → The Swagger documents `tamanho` from 1
  to 50 (not verified against the server). With 50, a full read costs 3 calls for
  customers (120), 2 for products (60), and 10 for receivables (472), so 15 calls
  instead of 33. Recorded in ADR 0002; F02 part 3 should use page size 50 and decides
  incremental reads.
- [Worst-case latency: 5 timeouts of 60 s plus 30 s of backoff ≈ 5.5 minutes] →
  Acceptable for background synchronization; any interactive use must pass a shorter
  timeout or not call the ERP inline. Revisit if a later P7 round shows a slow first call.
- [Shared squad quota: retries consume calls of other teammates] → At most 5 attempts,
  honoring `Retry-After`; no retry on 4xx or invalid responses.
- [New required variables break existing environments] → All automated environments get
  fake values in this change; developers must add the two variables to their own `.env`
  (documented in the change summary and `.env.example`).
- [`Retry-After: 0` repeatedly] → Bounded by the 5-attempt limit.
- [Redaction gaps for headers logged in unexpected shapes] → The client never logs
  headers; redaction is only a second layer.

## Migration Plan

No database migration and no API change. Deployment requires `ERP_API_URL` and
`ERP_API_KEY` in every environment before rollout; without them the backend refuses to
start, which is the intended fail-fast behavior. Rollback is reverting the change.

## Open Questions

- Real `429` and `5xx` bodies (P5) and the `Retry-After` format and per-minute limit
  (P6) (see the spec). The cold-start duration (P7) has one observation only. They are recorded in ADR 0002 as not
  verified; none of them changes the approach or the task
  breakdown, only constants, schema fields, and their tests.
