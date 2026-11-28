---
change_id: s1-04-user-administration
date: 2026-11-28
status: in-progress
owners: [João]
tags: [security, authentication, user-administration, invitation, api, sprint-1]
related_adrs: [ADR-0005]
openspec_change: openspec/changes/s1-04-user-administration/
---

# User administration and invitations (F01, backend, second part)

## Objective

Let the administrator list and register users, and let each invited person set their own password once through an invitation, with no self-registration. Users could only come from the seed before this change, so the portal could not onboard a new seller, manager or finance user.

## Change made

- New `user-administration` module (`src/modules/user-administration`) that depends only on `src/shared`. The administrator guard is injected from `src/app/create-app.ts`, which mounts `/api/v1/users` (guarded) and `/api/v1/invitations` (public) over one shared service. The service receives the clock, the invitation token generator and the password hasher by injection.
- Administrator routes: `GET /api/v1/users`, `POST /api/v1/users`, `POST /api/v1/users/{userId}/invitations` and `GET /api/v1/users/erp-seller-names`. Public routes: `POST /api/v1/invitations/lookup` and `POST /api/v1/invitations/accept`. Both public routes take the token in the body and answer `Cache-Control: no-store`.
- Additive migration `20261128120000_s1_04_user_invitations`: `users.password_hash` becomes nullable and the new `user_invitations` table stores only the SHA-256 digest (base64url) of each token, with a unique digest index, an index on `user_id` and a cascading foreign key to `users`. Dates are `timestamp(3)`, like every other migration. The migration carries a comment with the query that finds stored emails with uppercase letters, to be run before deploying to a database with data from another source than the seed. No applied migration was edited. Who issued an invitation is not stored.
- The account status (`ACTIVE`, `INVITED`, `INVITATION_EXPIRED`) is computed from the password and the invitation rows, never stored. An invitation expires exactly 48 hours after it is issued.
- Registration inserts the user and the first invitation in one write. A unique violation on `users.email` or `users.erp_seller_name` becomes `409` with the extension member `conflictField`. A new invitation revokes the user's open invitations in one transaction.
- Issuing and accepting an invitation both lock the user row (`SELECT ... FOR UPDATE`) before touching invitations, in the same order. Acceptance reads the `user_id` of the token, locks that user and only then runs the conditional update. This fixes two races found in the review of 2026-11-28: concurrent issues left several usable invitations, and an issue concurrent with an acceptance left a usable invitation for a user with a password.
- The ERP seller name is not trimmed and has no length limit of its own at registration; only a blank value is rejected. The list of available names excludes blank ones.
- The `409` of user registration is described by `RegistrationConflictProblem`: the shared `Problem` plus the required `conflictField` (`email` or `erpSellerName`).
- Acceptance hashes the password (8 characters to 72 bytes in UTF-8) before consuming anything, then runs one conditional `UPDATE ... RETURNING` with the injected clock instant (never the database `now()`), and sets `password_hash` in the same transaction only where it is still null. This makes single use hold under concurrent requests without locks.
- In `authentication`, `AuthenticationService.signIn` lowercases the submitted email before the lookup (the repository keeps the exact lookup, so whitespace is not removed). `StoredUser.passwordHash` is `string | null`; a user without a password follows the unknown-email path: dummy-hash comparison and the same `401`.
- `openapi.json` is regenerated from the same Zod schemas. The administrator operations declare `bearerAuth`/`cookieAuth` with `401` and `403`; the invitation operations declare no security.
- Two existing integration tests got a type-only adjustment (`passwordHash ?? ""`) because the column is now nullable; no assertion changed.

## Resulting behavior

- Sign-in ignores the letter case of the email; an email with surrounding whitespace is not found and opens no session.
- A registered user who has not accepted the invitation cannot sign in: the response is the same `401` as for an unknown email, no session is opened and the last login date stays empty.
- An administrator lists all users ordered by name with id, name, email, role, ERP seller name, last access, status and, for `INVITED`, the invitation expiry. Neither a hash nor a token nor a digest is listed.
- Registration returns `201` with the user in status `INVITED` and the token (shown only there and in the new-invitation response), with `Cache-Control: no-store`. The email is stored in lowercase.
- A seller needs an ERP seller name carried by a synchronized customer; other roles must not send one (`400`). A used email (any letter case) or ERP seller name answers `409` with `conflictField`, and nothing is created.
- A new invitation can be issued whatever the state of the previous one; the previous one stops working. A user with a password gets `409`; an unknown id gets `404`.
- The available ERP seller names are the distinct, non-blank names of synchronized customers that are not linked to a user, in alphabetical order, exactly as synchronized; registration accepts each of them unchanged, surrounding spaces included.
- Under concurrent requests, new invitations for one user leave exactly one usable invitation. A new invitation racing an acceptance ends in one of two ways: the acceptance succeeds, the new invitation gets `409` and none stays usable; or the new invitation succeeds and the acceptance gets the unusable `404`.
- Anyone holding a usable invitation can look it up (name, email, expiry) without consuming it, and accept it by setting a password, answered `204` with no session. An unknown, used, replaced or expired invitation gets one indistinguishable `404` (`Invitation link is invalid or expired.`); a password outside the limits or a malformed body gets `400`; of two concurrent acceptances exactly one succeeds.
- The token and the password are never written to logs.
- All administrator operations require a session of an `ADMIN` user (`401` with `WWW-Authenticate: Bearer`, then `403`), with the Bearer credential or the session cookie.

## Impact

- **API:** six new endpoints, documented in `openapi.json`. Sign-in keeps its contract; its email lookup becomes case-insensitive. No existing response shape changes.
- **Database:** one additive migration (nullable `users.password_hash`; new `user_invitations`). Rollback is a corrective migration that drops the table; restoring `NOT NULL` requires every user to have a password first and is not part of the rollback. The schema is owned by Benjamim; his notification is pending (task 1.3) and the pull request review is his acceptance.
- **Compatibility:** code that reads `passwordHash` must handle `null`; only sign-in did. Uniqueness of the email is case-insensitive only while every write path stores lowercase; any future import or seed must do the same.
- **Security:** tokens come from a CSPRNG (256 bits), only their digest is stored and they travel only in request and response bodies. Invitation routes have only the global rate limit of 100 requests per minute per IP. An invitation token copied elsewhere can be used by whoever holds it within 48 hours; single use and the administrator's new-invitation action limit that window.
- **Clients:** web and mobile were not changed here; the web builds the invitation link from the token (`s1-04-web-user-administration`).
- **Operations:** none; no new dependency or environment variable.

## Validations executed

Run on 2026-11-28, after the cycle 4 fixes, on branch `S1-04-auth-roles` (base `b223995`, uncommitted tree), with Docker available, as `npx -y pnpm@12.5.1 run <script>`.

| Command                                                                 | Result                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                                                     | `All matched files use Prettier code style!`                                                                                                                                                                                                                 |
| `pnpm verify`                                                           | Exit 0: `tsc --noEmit`, `eslint .`, unit `321 passed (321)`, architecture `3 passed (3)`, `openspec validate --all --strict`, `openapi:check`, `skills:check`                                                                                                |
| `pnpm test:integration`                                                 | `Test Files 14 passed (14)`, `Tests 174 passed (174)`                                                                                                                                                                                                        |
| `pnpm test:coverage`                                                    | `Tests 321 passed (321)`; all files: statements 98.33%, branches 96.63%, functions 97.67%, lines 98.27% (the configuration includes only `src/shared`)                                                                                                       |
| `pnpm build`                                                            | Exit 0                                                                                                                                                                                                                                                       |
| `pnpm test:container`                                                   | `All migrations have been successfully applied.` and `Production container smoke test passed.` (exit 0). A first run after the fixes exited 1 because another local process held port 3001 (`address already in use`); this is the rerun with the port free. |
| `./node_modules/.bin/openspec validate --all --strict --no-interactive` | `Totals: 9 passed, 0 failed (9 items)`                                                                                                                                                                                                                       |

### Red evidence and regression coverage

Commands and outputs are in `tasks.md`.

- **Cycle 1 (sign-in letter case):** Red: uppercase variant signs in (unit: `HttpProblem: Email or password is incorrect.`; integration: `expected 401 to be 200`). Regression coverage: uppercase variant with a wrong password; surrounding whitespace is not removed.
- **Cycle 2 (administrator side):** Red: `Tests 43 failed | 18 passed (61)` in the two `src/app` integration files (every failure an assertion, for example `expected 404 to be 201`), plus the user without a password at the service and 6 OpenAPI operations. The two cases that read `user_invitations` could only be confirmed after the migration. João accepted not writing unit tests for the new service; its behavior is covered by the HTTP tests with PostgreSQL.
- **Cycle 3 (public invitation):** Red: `Tests 18 failed (18)`, every failure an assertion. Cases that expect `404` also assert the Problem Details `detail`, so an unregistered route cannot satisfy them. One test counted all sessions, including the administrator session of its own fixture; João authorized restricting the count to the invited user, with the same expected value. Green: `Tests 18 passed (18)`.
- **Cycle 4 (review fixes):** Red: `Tests 4 failed (4)` in the two new integration files and `Tests 1 failed (1)` in the new OpenAPI file, every failure an assertion (for example several usable invitations instead of `1`, `acceptance fulfilled, issue fulfilled, password set, usable 1`, `expected 400 to be 201`). The concurrency file failed in 10 of 10 repeated runs before the fix and passed in 10 of 10 after it. The acceptance race uses the real service and repository on PostgreSQL with an instant injected password hasher; it was not measured over HTTP with bcrypt. Green: `Tests 4 passed (4)` and `Tests 1 passed (1)`; no test was changed.

Not asserted by an automated test: the rollback path where the user already has a password when the invitation is accepted, and the `400` of a malformed `userId` in `POST /api/v1/users/{userId}/invitations` (covered only by the Zod params schema).

## Related artifacts

- [Proposal](../../openspec/changes/s1-04-user-administration/proposal.md)
- Specifications: [user-administration](../../openspec/changes/s1-04-user-administration/specs/user-administration/spec.md), [user-invitation](../../openspec/changes/s1-04-user-administration/specs/user-invitation/spec.md), [user-authentication](../../openspec/changes/s1-04-user-administration/specs/user-authentication/spec.md), [role-authorization](../../openspec/changes/s1-04-user-administration/specs/role-authorization/spec.md)
- [Design](../../openspec/changes/s1-04-user-administration/design.md)
- [Tasks](../../openspec/changes/s1-04-user-administration/tasks.md)
- [ADR-0005](../adr/0005-invitation-based-account-activation.md), status `proposed`; related to [ADR-0004](../adr/0004-opaque-session-authentication.md)

**ADR evaluation:** required, and covered by ADR-0005. The account activation model changes a durable data contract (a user may exist without a password and a new table holds invitations) and establishes security invariants (token stored only as a digest, 48 hours, single use, revocation by replacement). It also changes a table owned by another front. Local choices such as the computed status, the `409` `conflictField` member, `POST` with the token in the body, and the `ERP seller names` query are recorded here and in the design, with no further ADR.

## Usage

An administrator signs in, calls `POST /api/v1/users` with `{ name, email, role, erpSellerName? }` and copies the returned token to the invited person, who confirms it with `POST /api/v1/invitations/lookup` and sets the password with `POST /api/v1/invitations/accept`. If the token is lost or expired, `POST /api/v1/users/{userId}/invitations` issues a new one. Apply the migrations first.

## Implementation notes

- The backend returns the token and the web client builds the link; no email is sent.
- Out of scope: editing, deactivating or deleting users, password reset or change, search and pagination, linking customers to the new seller (`Customer.sellerId`, a question for Benjamim, task 1.4), and invitation-specific throttling.
- A local database that applied an earlier version of `20261128120000_s1_04_user_invitations` (before `created_by_id` was removed or the comment was added) has a different checksum and should be recreated. The migration was not applied to any published environment.
- `s1-04-user-authentication` must be archived before this change, because this change adds requirements to a capability that one creates.
