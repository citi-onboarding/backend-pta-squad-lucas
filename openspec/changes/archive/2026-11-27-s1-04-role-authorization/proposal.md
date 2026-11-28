## Why

The two administrator-only ERP routes still rely on a static token that `s1-03-erp-sync` declared a stopgap until login exists (design D4, ADR 0003 decision 8: "F01 swaps it for the session user has role `ADMIN`"). Authentication (`s1-04-user-authentication`) now provides that session, and the web administrator screen cannot use a static token in a browser.

## What Changes

- **BREAKING** `GET /api/v1/sync/runs` and `POST /api/v1/sync/run` accept only a valid session of a user with role `ADMIN`, by Bearer or cookie. The `ADMIN_API_TOKEN` value no longer grants access.
- A missing, malformed, unknown, ended or expired session gets `401` with `WWW-Authenticate: Bearer`.
- A valid session with another role gets `403` and the synchronization service is not called.
- The routes keep their success payloads, `400`, `409` and behavior; `openapi.json` documents the new security and errors.

### Out of scope / Non-goals

- Any rule for another route. `GET /api/v1/sync/status` stays open; requiring a session there is only a recommendation of `s1-03-erp-sync` and needs its own decision. Example items, health and documentation routes are unchanged.
- A permission model beyond "administrator or not", seller portfolio rules (RN-08), invitations, user administration, web and mobile.
- Removing the `ADMIN_API_TOKEN` setting and its startup validation (see design, Pending Decisions).
- ERP client, scheduler, `ERP_SYNC_ENABLED` and synchronization rules.

## Capabilities

### New Capabilities

- `role-authorization`: which session and role may call administrator-only operations, and how refusals are answered.

### Modified Capabilities

None under `openspec/specs/`. The `admin-access` capability belongs to the still active change `s1-03-erp-sync`. This change supersedes its static-token credential rule, and its `ADDED` delta there was reconciled to refer to `role-authorization` (see design D4).

## Impact

- **Business:** administrators act with their own identity.
- **API:** same two routes; new `403`; credential changes.
- **Database:** no migration.
- **Security:** replaces a shared static secret with revocable, expiring sessions and a role check.
- **Operations:** anyone calling these routes with the token (the documented manual use in `docs/changes/s1-03-erp-sync.md`) must sign in as an administrator. No automated consumer was found in scripts, CI, Compose or tests outside the ERP tests; consumers outside the repository were not verified.
- **Observability:** no credential or personal data is logged.
- **Documentation:** ADR evaluation at consolidation, change summary, and the usage note above.
