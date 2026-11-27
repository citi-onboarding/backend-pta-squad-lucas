---
title: ADR-0002
status: proposed
date: 2026-11-26
owners: []
tags: [erp, integration, resilience]
supersedes: null
superseded_by: null
---

# 0002: ERP API access contract, retry policy, and error handling

## Context

The DistriLux ERP is the system of record for customers, products, receivables, and
orders. The whole squad shares one API key and one per-minute call quota. The ERP is
external, partly documented, and its behavior under load is largely unobserved. Before
any synchronization (F02 part 3) can be built, the backend needs one shared ERP read
client, and the team needs a durable record of what is known about the ERP, what is only
documented, and what is still unverified, so that code does not silently depend on
guesses.

Implemented by the OpenSpec change `s1-02-erp-client`
(`openspec/changes/s1-02-erp-client/`); the change summary is
`docs/changes/s1-02-erp-client.md` (written at consolidation).

### Facts confirmed in real ERP responses (2026-11-26)

- The key is sent in the `X-Api-Key` header (header names are case-insensitive).
- `GET /v1/clientes`, `/v1/produtos`, and `/v1/titulos` answer `200` with the envelope
  `{ dados, pagina, tamanho, total, totalPaginas }`. Observed totals: 120 customers,
  60 products, 472 receivables.
- The record fields of the three resources, named in Portuguese, are recorded in the
  change spec (P2).
- A request without the key answered `401` with a problem body. The same request also
  carried an invalid query parameter and still answered `401`: the key is checked before
  parameter validation. This is a single observation.
- An invalid query parameter answered `422` (not `400`) with a problem body whose
  `erros[].campo` is the name of the URL parameter. `atualizadoDesde` accepts a plain date
  or a date-time.
- An unknown path answered `404` with a problem body.
- `401`, `404`, and `422` bodies carry `type`, `title`, `status`, `detail`, `instance`,
  and `requestId`. `instance` contains the full path with the query string.
- First-call duration (P7), one round: about 20:07 Brazil time on 2026-11-26, after
  about 3 hours without calls from the developer (calls by other squad members in that
  interval are unknown). Three reads with page size 1 took 643 ms (customers, the first
  call), 250 ms (products), and 344 ms (receivables). No slow cold start was evident. It
  is not known whether the slower first call comes from the connection or from a heavier
  route.

### Facts documented in the ERP Swagger but not observed

- Closed status lists: customer `ATIVO`, `BLOQUEADO`, `INATIVO`; receivable `PAGO`,
  `EM_ABERTO`, `VENCIDO`.
- Query parameters of the three lists. `tamanho` accepts 1 to 50 and `pagina` has a
  minimum of 1; this came from the Swagger form, and no call reached the server. Update
  (2026-11-27): the real ERP accepted `tamanho=50` on the first real synchronization (see
  ADR 0003), so that value is now confirmed; the rest of this item is still documented only.
- Receivables are listed only from 2026-10-01: receivables issued before that date are
  not available from the ERP.
- The error schema `Problema` and `application/problem+json` error bodies. `429` is
  described as "see Retry-After".

### Not verified (deferred)

- A real `429` response (status, body, headers).
- A real `5xx` response.
- Whether `Retry-After` is sent, and whether it is in seconds or as an HTTP date.
- The per-minute call limit.

## Decision

1. **One injected read client.** `createErpClient` in `src/shared/erp/` exposes
   `erpGet(path, schema)`. `fetch`, sleep, clock, and logger are injected. Only `GET` is
   used, so retrying never duplicates data.
2. **Retry policy.** Retry on `429`, any `5xx`, a request that fails without a response,
   and a timeout, up to 5 attempts in total. Wait for a valid `Retry-After` (seconds or
   HTTP date, capped at 60 seconds); otherwise wait 2, 4, 8, and 16 seconds. Any other
   `4xx` fails immediately, as does an invalid `200` body, because retrying returns the
   same result and spends shared quota. The rule covers every `4xx` except `429`, so it
   does not depend on whether a validation error is `400` or `422`. The `Retry-After`
   handling follows the Swagger and the HTTP standard; it was never observed.
3. **Timeout.** The default request timeout is 60000 ms (`ERP_REQUEST_TIMEOUT_MS`). It
   is an initial value with a single P7 observation behind it: the first call took
   643 ms, so no slow cold start was seen. It stays and is revisited if a later round
   shows a slow first call. Upper bound for one read: about 9 minutes, computed as 5
   attempts of up to 60 seconds each (300 s) plus 4 waits of up to 60 seconds each, the
   cap on `Retry-After` (240 s); the case is a slow `429` that answers just before the
   timeout and asks for the longest wait. With only timeouts and the default backoff the
   bound is about 5.5 minutes (300 s plus 2 + 4 + 8 + 16 s). This is acceptable for
   background synchronization only. The timeout setting is planned to have a ceiling of
   120000 ms, which would make the absolute bound 5 x 120 s + 4 x 60 s = 840 s (14
   minutes).
4. **Every success body is validated** with Zod before use, regardless of media type.
   Unknown extra fields are accepted. An invalid body fails with an error that lists only
   field paths, never messages or received values.
5. **Error fields kept and discarded.** From an ERP error body the client keeps only
   `title`, `type`, `requestId`, and the list of `erros[].campo` (names of invalid URL
   parameters for a `422`). It discards `detail`, `instance`, and `erros[].mensagem`,
   because the observed bodies show they repeat the request: `instance` carries the full
   path with the query string and `mensagem` states the expected format of the sent
   value. Query strings may hold business data. `requestId` is kept because it lets the
   ERP team trace a call without exposing request data. Logs carry only the path without
   query string, the status or failure kind, the attempt number, and the wait.
6. **Key confidentiality.** The key lives only in the backend environment, travels only
   in the header, and never appears in errors, logs, or serialized forms.
7. **Read cost and page size for F02 part 3.** With the observed totals, reading
   everything costs 33 calls with page size 20 (6 + 3 + 24) and 15 calls with page size
   50 (3 customers + 2 products + 10 receivables). F02 part 3 should use page size 50,
   the documented maximum, and must confirm on its first real read that the server
   accepts it. Confirmed on 2026-11-27: the real ERP accepted page size 50 (ADR 0003).
8. **Receivable history starts on 2026-10-01.** Nothing built on this client, including
   any dashboard history, may assume older receivables exist in the ERP.
9. **Manual smoke check.** `pnpm erp:smoke` makes 3 real calls (page size 1) and prints
   only timing and counts. Automated tests never call the real ERP.

## Consequences

### Positive

- Transient ERP failures are absorbed without a custom behavior per module.
- A contract change in the ERP (a new status, a missing field) fails loudly with the
  field path instead of reaching synchronization silently.
- Error handling does not leak the key, record data, or values repeated by the ERP. For
  the error bodies actually observed (`401`, `404`, and `422`) this holds because only
  `title`, `type`, `requestId`, and field names are kept; the `title` of a real `429` or
  `5xx` body has not been observed (P5, pending), so the guarantee is not yet verified
  for those.
- Page size 50 cuts the cost of a full read from 33 to 15 calls of the shared quota.

### Negative

- Retries consume shared quota, and the quota limit itself is unknown.
- The retry waits for `429` rest on documented, unobserved behavior; a real `429` may
  differ from what the Swagger says.
- A closed status list that is incomplete in the Swagger makes reads of that resource
  fail until the spec and the enum are updated.
- The 60000 ms timeout and the P7 conclusion rest on one measurement.
- The `401`-before-validation order rests on one observation.
- ~~The 50-record page size is documented but not confirmed against the server.~~
  Confirmed on 2026-11-27: the real ERP accepted `tamanho=50` (ADR 0003).

### Limitations and follow-ups

- **No cancellation or per-call deadline.** The timeout is fixed per client
  (`ERP_REQUEST_TIMEOUT_MS`), and the default sleep cannot be cancelled. A caller cannot
  abort a read, and a shutdown during a wait lets the read run until it ends. F02 part 3
  must create a separate client with a shorter timeout for interactive use and must handle
  shutdown.
- **Requests that hit the timeout may still consume ERP quota** (not verified). The
  retry budget counts them as attempts, but the ERP may count them as calls too.
- **The body of a retried response is not consumed** before the next attempt (low
  severity, deferred), which may keep the connection from being reused.
- **One unknown status drops a whole page.** The closed status lists make a single
  unexpected record fail the whole read. F02 part 3 should validate record by record, or
  log a warning with only the field path, instead of discarding the page.
- **`ErpError` is not mapped to an HTTP response yet.** F02 part 3 must define where it
  becomes a safe response.
- **"Fails loudly" depends on an alert that does not exist yet.** An invalid-response
  error is only noticed if something raises it; F02 part 3 must create that alert.

## Alternatives considered

### Failing immediately on network errors

Rejected: retrying on network failures and slow starts is a requirement of the client
(RN-15), not an observed fact about the ERP. The only first-call measurement (P7, 643 ms)
shows no slowness. Retrying remains the safer default for a read-only client.

### Keeping `detail` and `erros[].mensagem` in errors for easier debugging

Rejected: the observed bodies repeat request values, which may be business or personal
data. The `requestId` and the invalid field names are enough to investigate.

### Requiring `application/json` before parsing bodies

Rejected: the ERP documents `application/problem+json` for errors, and rejecting a
valid body for its media type adds failures without protecting any data.

### Page size 20 for synchronization

Not selected: it costs 33 calls per full read against 15 with page size 50, on a quota
shared by the whole squad.

## References

- OpenSpec change: `openspec/changes/s1-02-erp-client/` (spec `erp-integration`,
  `design.md`, `tasks.md`).
- ERP Swagger documentation (read on 2026-11-26).
- Smoke check: README section "ERP smoke check".
