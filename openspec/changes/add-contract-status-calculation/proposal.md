## Why

DistriLux supply contracts sit in a folder and nobody tracks their dates, so contracts have expired without anyone sending the renewal notice in time. F21 (US-021, RN-11) needs every contract to carry a status that tells the commercial manager whether action is required. This change delivers only the first, isolated part of F21: the rule that derives a contract's status from its dates, so that later parts of the task (seed, endpoint, web table) can rely on a single tested calculation.

## What Changes

- Add a pure calculation that, given a contract's resolved end date, its notice period in calendar days, and an explicit reference date ("today"), returns the contract status and, when applicable, the notice deadline.
- Notice deadline = end date − notice days (RN-11), in calendar days.
- Four statuses, evaluated in this priority order: `EXPIRED` ("Vencido"), `NOTICE_OVERDUE` ("Prazo de aviso vencido"), `NOTIFY_BY` ("Avisar até [data]", 0 to 30 days inclusive before the deadline), `ON_TRACK` ("Em dia", more than 30 days before the deadline).
- Add the `date-fns` runtime dependency, which the F21 task prescribes for calendar-day arithmetic.

In scope:

- The status calculation and its unit tests.
- The planning and documentation artifacts required by the repository for this part.

Out of scope (still pending for the rest of F21 or owned by other tasks):

- Prisma schema, migrations, the six sample contracts in the test database, and any database access.
- `GET /api/v1/contracts`, list ordering by notice deadline, request/response validation, and the OpenAPI contract.
- Permissions and authentication (the allowed roles are awaiting alignment between the task and the PRD).
- Web table, legend, and mobile app.
- PDF reading, amendment selection, AI triage, alerts and notifications (F20/F22).
- Recalculating automatic renewals, business days, or any field beyond the three inputs above.
- Validating the expected result of the six sample contracts with today fixed on 2026-11-22: their documents were not provided, so that answer key is not verified by this change.

## Capabilities

### New Capabilities

- `contract-status`: derives the notice deadline and the status of a supply contract from its resolved end date, its notice period, and a reference date.

### Modified Capabilities

None.

## Impact

- **Business**: gives the commercial team a single, deterministic definition of when a contract needs attention, matching US-021 and RN-11. The 30-day threshold follows the task; the PRD lists as an open question (owner: Fernanda Cavalcanti) whether it varies per client. This change keeps the fixed 30 days and does not decide that question.
- **API**: none. No route, schema, or `openapi.json` change.
- **Database / migrations**: none.
- **Security**: none. The calculation reads no personal data, credentials, or external input; it performs no I/O and logs nothing.
- **Observability**: none.
- **Dependencies**: adds `date-fns` 4.4.0 as a runtime dependency.
- **Documentation**: a change summary in `docs/changes/add-contract-status-calculation.md`. No ADR is expected, since the decision is local and reversible.
- **Code**: new files `src/modules/contracts/contract-status.ts` and `src/modules/contracts/contract-status.test.ts` only.
