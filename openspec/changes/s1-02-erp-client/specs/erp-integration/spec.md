## Purpose

Lets the backend read customers, products, and receivables from the DistriLux ERP
safely: configured and checked at startup, resilient to quota limits and outages,
validated before use, without ever exposing the shared API key, and with ERP amounts
in cents presentable as Brazilian reais.

## ERP API facts

This section records what is known about the external ERP API so that requirements do
not silently depend on guesses. Each fact is classified as _confirmed_ (observed in a real
ERP response), _documented_ (stated in the ERP Swagger documentation but not observed),
or _pending verification_. Pending items MUST be resolved or explicitly carried over in
ADR 0002 before this change is archived.

### Confirmed (observed in real ERP responses, 2026-11-26)

- Base URL: `https://pta-erp-api.onrender.com`, without trailing slash and without `/docs`.
- P1: Real reads authenticated with the API key in the request header `X-Api-Key`
  succeeded. Header names are case-insensitive.
- Real list reads of `/v1/clientes`, `/v1/produtos`, and `/v1/titulos` answered `200`.
- P3: Every list of customers, products, and receivables observed was wrapped in an
  envelope `{ dados, pagina, tamanho, total, totalPaginas }`, where `dados` is the array
  of records. A page is the last one when `pagina` equals `totalPaginas`. With `tamanho`
  20, the observed totals were 120 customers (6 pages), 60 products (3 pages), and 472
  receivables (24 pages): reading everything costs 33 calls of the shared quota.
- P2: Record fields observed, named in Portuguese:
  - customer: `codigo` (string, such as `C0001`), `razaoSocial`, `cnpj` (string of 14
    digits, no mask), `cidade`, `uf`, `segmento` (free text), `limiteCreditoCentavos`
    (integer), `vendedor`, `dataCadastro` (date `YYYY-MM-DD`), `status` (string; the
    closed list is documented, see below), `atualizadoEm` (date-time with UTC offset).
  - product: `codigo` (string, such as `P00001`), `descricao`, `categoria` (free text),
    `unidade` (free text), `precoTabelaCentavos` (integer), `ativo` (boolean; products
    have no `status`), `atualizadoEm` (date-time with UTC offset, such as
    `2026-01-01T00:00:00-03:00`).
  - receivable: `numero` (integer), `cliente` (string, the customer `codigo`),
    `pedidoErp` (integer), `parcela` (string, such as `2/3`), `valorCentavos` (integer),
    `emissao` (date), `vencimento` (date), `pagamento` (date or `null`), `status`
    (string; observed `PAGO` and `EM_ABERTO`), `atualizadoEm` (date-time with UTC
    offset). One `pedidoErp` may produce several receivables (installments).
- An unknown path answered `404` with a JSON body containing `type`, `title`, `status`,
  `detail`, `instance`, and `requestId`.
- P5 (`401`): a request without the API key answered `401` with a body containing
  `type` (`about:blank`), `title` (`Não autorizado`), `status` (`401`), `detail`,
  `instance`, and `requestId`. `instance` equals the request path including the query
  string. The same request also carried an invalid query parameter and still answered
  `401`, which indicates that the key is checked before parameter validation (a single
  observation).
- P5 (`422`): an invalid query parameter answered `422`, not `400`, with a body
  containing `type`, `title` (`Entidade não processável`), `status` (`422`), `detail`,
  `instance` (with the query string), `requestId`, and `erros`: a list of
  `{ campo, mensagem }` objects. Here `erros[].campo` is the name of the URL parameter
  (observed: `atualizadoDesde`). The `mensagem` states that a date (`YYYY-MM-DD`) or a
  date-time (ISO 8601) is expected, which also confirms that `atualizadoDesde` accepts
  both forms.
- P7 (single observation, 2026-11-26, about 20:07 Brazil time, after about 3 hours
  without calls from the developer; calls by other squad members in that interval are
  unknown): three reads with page size 1 took 643 ms (customers, the first call),
  250 ms (products), and 344 ms (receivables). No slow cold start was evident. The first
  call was slower than the next two, but it is not known whether the cause is the
  connection or a heavier route. The totals matched earlier reads (120, 60, and 472).
- `requestId` was present in every observed error body (`401`, `404`, `422`), although
  it is absent from the `Problema` schema.

### Documented (ERP Swagger, 2026-11-26; not observed)

- Read paths are versioned under `/v1` and named in Portuguese: `/v1/clientes`,
  `/v1/clientes/{codigo}`, `/v1/produtos`, `/v1/produtos/{codigo}`, `/v1/titulos`,
  `/v1/pedidos`, `/v1/pedidos/{numero}`. Only the three list paths above were observed.
- Customer `status` is the closed list `ATIVO`, `BLOQUEADO`, and `INATIVO`.
- P4 (customers): `GET /v1/clientes` accepts `pagina` (integer, default 1), `tamanho`
  (integer, default 20), `uf` (string), `status` (`ATIVO`, `BLOQUEADO`, or `INATIVO`),
  and `atualizadoDesde` (date-time; a plain date is also accepted, see the confirmed
  `422` fact).
- P4 (page size, from the Swagger form; no call reached the server): `tamanho` accepts
  integers from 1 to 50, and `pagina` has a minimum of 1.
- P4 (products): `GET /v1/produtos` accepts `pagina` (integer), `tamanho` (integer),
  `categoria` (string), `ativo` (string restricted to a list of options whose values
  were not seen), and `atualizadoDesde` (date-time). The documentation shows `1` and
  `20` as initial values for `pagina` and `tamanho`; whether they are defaults is not
  verified.
- P4 (receivables): `GET /v1/titulos` is described as listing receivables issued since
  2026-10-01, so receivables issued before that date are not available from the ERP.
  It accepts `pagina` (integer, default 1), `tamanho` (integer, default 20), `cliente`
  (string), `status` (`PAGO`, `EM_ABERTO`, or `VENCIDO`), `emissaoDesde` (date),
  `vencimentoAte` (date), and `atualizadoDesde` (date-time).
- `GET /v1/pedidos` lists the orders of the calling team.
- P2-status (resolved): the receivable schema `Titulo` restricts `status` to the closed
  list `PAGO`, `EM_ABERTO`, and `VENCIDO`.
- P5 (shape): the error schema `Problema` requires `type`, `title`, `status` (integer),
  `detail`, and `instance`, and has an optional `erros`: a list of objects that each
  require `campo` and `mensagem`. `detail` and `erros[].mensagem` may repeat values sent
  in the request.
- P6 (partial): `429` is described as "Limite de requisições excedido (veja
  Retry-After)", with media type `application/problem+json` and a `Problema` body. No
  response header is documented.
- Error bodies are documented as `application/problem+json`, not `application/json`.

### Pending verification

These items are deferred to ADR 0002 as not verified. The smoke script (`pnpm erp:smoke`)
can repeat the first-call measurement (P7).

- P5 (real bodies): whether real `429` and `5xx` responses carry a `Problema` body with
  `requestId`. The `401`, `404`, and `422` bodies are confirmed.
- P5 (real `429`): a real `429` response has not been observed yet.
- P5 (real `5xx`): a real `5xx` response has not been observed yet.
- P6 (header): whether `Retry-After` is actually sent on `429`, in seconds or as an HTTP
  date, and the per-minute limit.
- P7 (further rounds): the single observation above shows no evident slow cold start,
  but one round cannot rule it out. The default timeout of 60000 ms stays as an initial
  value, to be revisited if a later round shows a slow first call.

## ADDED Requirements

### Requirement: ERP configuration at startup

The backend MUST require the ERP base URL and the ERP API key at startup and MUST refuse
to start when either is missing or invalid. The base URL MUST be an absolute `https` URL
without a trailing slash. The API key MUST be a non-empty string. The per-request timeout
MUST be configurable in a single setting, MUST be a positive integer number of
milliseconds not greater than 120000, and MUST default to 60000 when absent. The ceiling
keeps the worst-case duration of one read bounded. Startup errors MUST name the
offending setting and MUST NOT print the value of the API key.

#### Scenario: All ERP settings are valid

- **WHEN** the backend starts with a valid ERP base URL and a non-empty API key, and no timeout setting
- **THEN** startup succeeds and the request timeout is 60000 milliseconds

#### Scenario: ERP base URL is missing

- **WHEN** the backend starts without the ERP base URL
- **THEN** startup fails with an error naming `ERP_API_URL`

#### Scenario: ERP base URL is not an https URL or ends with a slash

- **WHEN** the backend starts with an ERP base URL that is not absolute `https`, or that ends with `/`
- **THEN** startup fails with an error naming `ERP_API_URL`

#### Scenario: ERP API key is missing or empty

- **WHEN** the backend starts without the ERP API key, or with an empty one
- **THEN** startup fails with an error naming `ERP_API_KEY`

#### Scenario: ERP API key value is not echoed

- **WHEN** startup fails because of any ERP setting
- **THEN** the error output does not contain the API key value

#### Scenario: Timeout setting is invalid

- **WHEN** the backend starts with a request timeout that is zero, negative, or not an integer
- **THEN** startup fails with an error naming `ERP_REQUEST_TIMEOUT_MS`

#### Scenario: Timeout setting is above the ceiling

- **WHEN** the backend starts with a request timeout of 120001 milliseconds or more
- **THEN** startup fails with an error naming `ERP_REQUEST_TIMEOUT_MS`

#### Scenario: Timeout setting is at the ceiling

- **WHEN** the backend starts with a request timeout of exactly 120000 milliseconds
- **THEN** startup succeeds and the request timeout is 120000 milliseconds

### Requirement: Authenticated ERP read

Every ERP read MUST be an HTTP `GET` to the configured base URL followed by the requested
path, including any query string supplied by the caller. Every ERP read MUST send the API
key in the `X-Api-Key` request header and MUST NOT send it in the URL. The requested path
MUST start with `/`, so that the request target can never change the host of the
configured base URL (for example through a path that starts with `@` or `.`). A read of a
path that does not start with `/` MUST be rejected as a programming error (a `TypeError`,
not an ERP error) before any request is made, and the error message MUST NOT contain the
path.

#### Scenario: Successful read

- **WHEN** the ERP answers `200` with a body that matches the expected shape
- **THEN** the read returns the validated data after exactly one attempt

#### Scenario: Path does not start with a slash

- **WHEN** a read is requested for `v1/clientes`, for an empty path, or for a path such as `@other.example.invalid/v1/clientes` or `.other.example.invalid/v1/clientes`
- **THEN** the read is rejected with a `TypeError` that is not an ERP error, no request is made, and the error message does not contain the path

#### Scenario: Request target and credentials

- **WHEN** a read of `/v1/clientes?pagina=1&tamanho=20` is performed
- **THEN** exactly one `GET` is sent to the base URL followed by that path, with the API key in the `X-Api-Key` header and not in the URL

### Requirement: Retry on transient ERP failures

An ERP read MUST be retried when the ERP answers `429` or any `5xx` status, when the
request fails without a response, or when the request exceeds the configured timeout. A
read MUST make at most 5 attempts in total. Before each retry the read MUST wait: when
the failed response carries a valid `Retry-After` value, either as a number of seconds or
as an HTTP date, the wait MUST follow it, capped at 60 seconds; otherwise the wait MUST
be 2, 4, 8, and 16 seconds before the 2nd, 3rd, 4th, and 5th attempts. A `Retry-After`
value that is missing, unparseable, negative, or in the past MUST fall back to that
backoff. Each retry MUST emit one warning log entry containing only the path without
query string, the status or failure kind, the attempt number, and the wait.

#### Scenario: Quota limit, then success

- **WHEN** the ERP answers `429` and then `200` with a valid body
- **THEN** the read waits and retries once, and returns the data after 2 attempts

#### Scenario: Retry-After in seconds

- **WHEN** the ERP answers `429` with `Retry-After: 7` and then `200`
- **THEN** the read waits 7 seconds before the second attempt

#### Scenario: Retry-After as an HTTP date

- **WHEN** the ERP answers `429` with a `Retry-After` date 10 seconds in the future and then `200`
- **THEN** the read waits 10 seconds before the second attempt

#### Scenario: Retry-After above the cap

- **WHEN** the ERP answers `429` with `Retry-After: 3600` and then `200`
- **THEN** the read waits 60 seconds before the second attempt

#### Scenario: Retry-After invalid

- **WHEN** the ERP answers `429` with an unparseable, negative, or past `Retry-After` and then `200`
- **THEN** the read waits 2 seconds before the second attempt

#### Scenario: ERP server error, then success

- **WHEN** the ERP answers `503` and then `200` with a valid body
- **THEN** the read waits 2 seconds, retries, and returns the data

#### Scenario: No connection, then success

- **WHEN** the first request fails without any response and the second answers `200` with a valid body
- **THEN** the read retries and returns the data

#### Scenario: Timeout, then success

- **WHEN** the first request exceeds the configured timeout and the second answers `200` with a valid body
- **THEN** the read retries and returns the data

#### Scenario: Five consecutive failures

- **WHEN** the ERP fails transiently on all 5 attempts
- **THEN** the read waits 2, 4, 8, and 16 seconds between attempts, makes no sixth attempt, and fails with an ERP error reporting the last failure and 5 attempts

#### Scenario: Retry is logged without sensitive data

- **WHEN** a read of a path with a query string is retried
- **THEN** one warning entry is logged with the path without query string, the status or failure kind, the attempt number, and the wait, and without headers, body content (including `detail` and `erros[].mensagem`), or API key

### Requirement: Immediate failure on non-retryable ERP responses

An ERP read MUST fail immediately, without retrying, when the ERP answers any non-success
status other than `429` and `5xx`. The failure MUST be an ERP error that states the
status, the path without query string, and the number of attempts.

#### Scenario: Unauthorized, forbidden, or not found

- **WHEN** the ERP answers `401`, `403`, or `404`
- **THEN** the read fails after exactly one attempt with an ERP error stating that status

#### Scenario: Validation error is not retried

- **WHEN** the ERP answers `422` (the status observed for an invalid query parameter)
- **THEN** the read fails after exactly one attempt, without waiting, with an ERP error stating `422`

#### Scenario: Any other client error is not retried

- **WHEN** the ERP answers any `4xx` status other than `429`, such as `400` or `422`
- **THEN** the read fails after exactly one attempt with an ERP error stating that status

### Requirement: Safe ERP error details

Whenever an ERP read fails with an HTTP status, immediately or after the last attempt,
the error body MUST be read on a best-effort basis as JSON regardless of its media type
(`application/json`, `application/problem+json`, or none). From that body the ERP error
MUST carry only these fields, each only when present with the expected type: `title`
(string), `type` (string), `requestId` (string), and the list of `campo` values of the
`erros` entries (strings). The ERP error MUST NOT carry `detail`, `instance`,
`erros[].mensagem`, or any other body content in its fields, message, or serialized
form, and none of them MUST appear in log entries, because they may repeat values sent
in the request. A body that is not JSON, or that lacks some of these fields, MUST NOT
change the error kind or status.

#### Scenario: Problem body on a non-retryable status

- **WHEN** the ERP answers `404` with media type `application/problem+json` and a body with `type`, `title`, `status`, `detail`, `instance`, and `requestId`
- **THEN** the ERP error carries the `type`, `title`, and `requestId` values and contains neither the `detail` nor the `instance` value

#### Scenario: Field list without messages

- **WHEN** the ERP answers `422` with a problem body whose `erros` contains an entry whose `campo` is a URL parameter name (such as `tamanho`) and a `mensagem` that repeats the sent value, and whose `instance` includes the query string
- **THEN** the ERP error carries the field list `["tamanho"]` and contains none of that `mensagem`, the `detail` value, or the `instance` value

#### Scenario: Problem body after exhausted retries

- **WHEN** the ERP answers `429` with a problem body on all 5 attempts
- **THEN** the ERP error states `429` and 5 attempts and carries the safe fields of the last body only

#### Scenario: Error body is not in the expected shape

- **WHEN** the ERP answers `401` with a body that is not JSON, or JSON without the safe fields
- **THEN** the read fails with an ERP error stating `401` and no `title`, `type`, request identifier, or field list

### Requirement: ERP response validation

Every successful ERP response MUST be validated against the expected shape before any
data is returned. The body MUST be parsed as JSON regardless of the response media type;
the read MUST NOT require the media type to be exactly `application/json`. A response that does not match MUST make the read fail, without
retrying, with an invalid-response ERP error. That error MUST list only the paths of the
failing fields (such as `dados.0.cnpj`) and MUST NOT contain validation messages or any
received value. Fields the ERP sends beyond the expected shape MUST be accepted.

The expected shapes MUST follow the confirmed ERP fields (P2, P3) and the documented
customer and receivable status lists:

- a customer requires every confirmed customer field; `cnpj` MUST be exactly 14 digits;
  `status` MUST be `ATIVO`, `BLOQUEADO`, or `INATIVO`;
- a product requires every confirmed product field; `ativo` MUST be a boolean;
- a receivable requires every confirmed receivable field; `pagamento` MUST be a date or
  `null`; `status` MUST be `PAGO`, `EM_ABERTO`, or `VENCIDO`;
- dates MUST be `YYYY-MM-DD`, and `atualizadoEm` MUST be a date-time with a UTC offset;
- every amount in cents (`limiteCreditoCentavos`, `precoTabelaCentavos`,
  `valorCentavos`) MUST be a safe integer;
- a list MUST be an envelope with `dados` (array of the expected records) and integer
  `pagina`, `tamanho`, `total`, and `totalPaginas`.

#### Scenario: Valid list of customers

- **WHEN** the ERP answers `200` with an envelope whose `dados` contains valid customers
- **THEN** the read returns the envelope with the customers and the paging fields

#### Scenario: Valid product and receivable

- **WHEN** the ERP answers `200` with a valid product, or with a valid receivable whose `pagamento` is `null`
- **THEN** the read returns the record

#### Scenario: Several installments of one order

- **WHEN** the ERP answers `200` with an envelope containing two receivables with the same `pedidoErp` and different `parcela`
- **THEN** the read returns both receivables

#### Scenario: Every documented receivable status

- **WHEN** the ERP answers `200` with a receivable whose `status` is `PAGO`, `EM_ABERTO`, or `VENCIDO`
- **THEN** the read returns the record

#### Scenario: Unknown receivable status

- **WHEN** the ERP answers `200` with a receivable whose `status` is outside `PAGO`, `EM_ABERTO`, and `VENCIDO`
- **THEN** the read fails with an invalid-response ERP error listing the `status` field path and does not retry

#### Scenario: Media type is not required

- **WHEN** the ERP answers `200` with a valid body and a media type other than `application/json`, or none
- **THEN** the read returns the validated data

#### Scenario: Body does not match the expected shape

- **WHEN** the ERP answers `200` with a record missing a required field, with a wrong type, with a `cnpj` that is not 14 digits, with an unknown customer or receivable `status`, or with a malformed date
- **THEN** the read fails with an invalid-response ERP error and does not retry

#### Scenario: Invalid-response error exposes field paths only

- **WHEN** the ERP answers `200` with an envelope whose first customer has an invalid `cnpj`
- **THEN** the ERP error lists the path `dados.0.cnpj` and contains neither the validation message nor the received `cnpj` value

#### Scenario: Body has extra fields

- **WHEN** the ERP answers `200` with a valid customer, product, or receivable plus an unknown field
- **THEN** the read returns the record

#### Scenario: Amount in cents is not an integer

- **WHEN** the ERP answers `200` with a fractional `precoTabelaCentavos`
- **THEN** the read fails with an invalid-response ERP error

#### Scenario: Envelope is incomplete

- **WHEN** the ERP answers `200` with a list without `totalPaginas`
- **THEN** the read fails with an invalid-response ERP error

### Requirement: ERP API key confidentiality

The ERP API key MUST be used only by the backend. It MUST NOT appear in any ERP error
message, stack trace, or serialized form, nor in any log entry produced by ERP reads or
by request logging.

#### Scenario: Key is absent from errors

- **WHEN** an ERP read fails for any reason
- **THEN** the error message, stack trace, and JSON serialization do not contain the API key value

#### Scenario: Key is absent from logs

- **WHEN** ERP reads are retried and fail
- **THEN** no captured log line contains the API key value

### Requirement: Manual ERP smoke check

The repository MUST provide a manual smoke check, run by a developer with the real ERP
key and never by automated tests, that performs exactly one read per resource (customers,
products, and receivables) with page size 1, through the ERP client and the page
envelope schema of each resource. For each resource it MUST print only the resource name,
the elapsed time in milliseconds, the number of records in `dados`, `total`, and
`totalPaginas`. It MUST NOT print the API key, headers, or any record content. It MUST
stop at the first failure. On failure it MUST print only the resource name and the safe
facts the ERP error exposes (kind, status, attempts, `title`, `type`, `requestId`, field
names, and field paths of an invalid response), and MUST finish with a non-zero exit code.

#### Scenario: All reads succeed

- **WHEN** the three reads succeed
- **THEN** exactly 3 reads are made, to `/v1/clientes`, `/v1/produtos`, and `/v1/titulos` with `pagina=1&tamanho=1`, and one line per resource states the elapsed time, record count, `total`, and `totalPaginas`

#### Scenario: Output has no record content or key

- **WHEN** the reads return records with names and identifiers
- **THEN** no printed line contains any record value, the API key, or a header

#### Scenario: A read fails

- **WHEN** a read fails with an ERP error
- **THEN** the remaining resources are not read, only the safe error facts are printed, and the result is a failure

### Requirement: Cents formatting

The backend MUST format an integer number of cents as Brazilian reais in the pt-BR
format, with the `R$` symbol, `.` as thousands separator, `,` as decimal separator, and
two decimal places. The separator between `R$` and the digits MUST be a non-breaking
space (U+00A0), as produced by the standard pt-BR locale; the examples below show it as a
regular space for readability. Negative amounts MUST be formatted as negative. Values
that are not safe integers MUST be rejected.

#### Scenario: Positive amount

- **WHEN** 123456 cents are formatted
- **THEN** the result is `R$ 1.234,56`

#### Scenario: Zero and small amounts

- **WHEN** 0 cents and 5 cents are formatted
- **THEN** the results are `R$ 0,00` and `R$ 0,05`

#### Scenario: Negative amount

- **WHEN** -100 cents are formatted
- **THEN** the result is `-R$ 1,00`

#### Scenario: Not an integer

- **WHEN** 10.5, `NaN`, or a number beyond the safe integer range is formatted
- **THEN** formatting fails with an error
