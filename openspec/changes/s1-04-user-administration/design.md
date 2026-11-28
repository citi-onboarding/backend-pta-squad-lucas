## Context

See `proposal.md` for motivation and `specs/` for the required behavior.

- `User` (`s1-01-data-model`) has `passwordHash String` (`NOT NULL`), `email String @unique` with a case-sensitive unique index, `erpSellerName String? @unique` and `lastLoginAt`. There is no field or table for invitations. Benjamim owns the schema; his agreement on 27/11 covered only `sessions.token_digest`.
- `Customer.erpSellerName` holds the seller text exactly as the ERP sends it. Nothing fills `Customer.sellerId` today; linking customers to sellers belongs to the ERP synchronization.
- The seed creates the 8 prototype users with lowercase emails and bcrypt hashes (`src/shared/security/password.ts`, cost 10).
- `src/modules/authentication` provides sign-in (exact email lookup, dummy-hash comparison for unknown emails), session resolution and `createAdminSessionGuard`. `create-app.ts` injects the guard into the `erp-sync` router as `adminGuard`; modules must not import each other.
- Global rate limit of 100 requests per minute per IP; problem responses follow RFC 9457.

## Goals / Non-Goals

**Goals:**

- One new module, `src/modules/user-administration`, that serves both capabilities (`user-administration` and `user-invitation`), depends only on `src/shared` and receives the administrator guard by injection from `src/app`.
- Every time-dependent rule (48-hour expiry, list status) reads an injected clock, so tests control it.
- Single use guaranteed by the database, not by a read-then-write sequence.

**Non-Goals:**

- Promoting the opaque-token helpers of `authentication` to `src/shared` during Green; it is considered in Refactor (D5).
- Any change to how sessions are created, renewed or ended.

## Decisions

### D1. Account activation model: nullable password plus an invitation table (approved by João; pending Benjamim)

A registered user is a real `User` row with `passwordHash = NULL`. Invitations live in a new table:

```
user_invitations
  id             uuid primary key
  user_id        uuid not null references users(id) on delete cascade
  token_digest   text not null unique      -- SHA-256 of the token, base64url
  created_at     timestamp(3) not null default now()
  expires_at     timestamp(3) not null      -- created_at + 48 h
  used_at        timestamp(3) null
  revoked_at     timestamp(3) null          -- set when a newer invitation replaces it
  index (user_id)
```

and `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`.

- The user exists from registration, so email and ERP seller uniqueness stay enforced by the existing unique indexes, and the list reads one table.
- Dates use `timestamp(3)`, like every other migration of the repository. Who issued an invitation is not stored: no spec needs it and the administrator guard does not expose the identity (decided by João on 2026-11-28).
- Alternatives rejected: (B) invitation rows carrying name/email/role until acceptance — uniqueness would need checks across two tables, and pending people would not be users; (C) a sentinel unusable hash in `password_hash` — hides the account state and breaks the "only a hash of each password" meaning.
- Consequence: code that reads `passwordHash` must handle `null`. Only sign-in does today (D6).

### D2. Status is computed, not stored

`ACTIVE` when `passwordHash` is set. Otherwise `INVITED` if a row exists with `used_at IS NULL AND revoked_at IS NULL AND expires_at > now`, else `INVITATION_EXPIRED`. Exactly 48 hours is expired, matching the 8-hour session rule. Nothing rewrites expired rows. The list is ordered by `name` with a stable secondary order on `email`.

### D3. Registration in one transaction

Validate the body with Zod (`.strict()`): `name` trimmed 1–120, `email` valid ≤254 then lowercased, `role` enum, `erpSellerName` required only for `SELLER` and forbidden otherwise (`400`). For a seller, the name must appear in `customers.erp_seller_name` (`400` otherwise). Then, in one transaction, insert the user and the invitation. A unique violation on `users.email` or `users.erp_seller_name` maps to `409` Problem Details with the extension member `conflictField` (`"email"` or `"erpSellerName"`), declared in the OpenAPI schema, so the web shows a fixed message for that field. Existing rows are not rewritten. The seed is lowercase; the migration carries a comment with the query that finds stored emails with uppercase letters, to be run before deploying to any database with data from another source (revised on 2026-11-28: a deployment check, not an automated test).

Case-insensitive uniqueness relies on every write path storing lowercase. A functional unique index on `lower(email)` was rejected: Prisma cannot represent it and `migrate diff` would keep proposing to drop it.

### D4. New invitation revokes the previous ones

In one transaction: refuse (`409`) if the user has a password, set `revoked_at = now` on the user's open invitations, insert a new one. Unknown id → `404`; non-UUID id → `400`.

Both issuing and accepting an invitation run in a transaction that first locks the user row (`SELECT ... FOR UPDATE`) and only then touches invitations. Acceptance reads the `user_id` of the token, locks that user, and then runs the conditional update of D7. The same lock order in both paths avoids deadlocks. Without the lock, concurrent issues leave two open invitations (reproduced in the review of 2026-11-28).

### D5. Token generation and digest

32 random bytes from `node:crypto`, base64url (43 characters), digest SHA-256. The token is returned only in the `201` bodies of registration and new invitation. The module owns a small `invitation-token.ts` because it cannot import `authentication/session-token.ts`; promoting a shared `opaque-token` helper to `src/shared/security` is a Refactor candidate, to be proposed with its benefit and approved before it is applied.

### D6. Sign-in changes in `authentication`

- `AuthenticationService.signIn` lowercases the submitted email before calling the store, which keeps its exact lookup (decided by João on 2026-11-28: the rule lives in the use case and is covered by its unit tests). Whitespace is untouched, so a padded email does not match (the current request schema may already reject it as `400`; either way it is not `200`).
- `StoredUser.passwordHash` becomes `string | null`. A `null` hash is compared against the existing dummy hash and the user is rejected whatever the comparison returns, reusing the unknown-email path, so the `401` and its cost are the same.

### D7. Lookup and acceptance are public, token in the body

`POST /api/v1/invitations/lookup` `{ token }` → `200 { name, email, expiresAt }`. `POST /api/v1/invitations/accept` `{ token, password }` → `204`. Both are `POST` with the token in the body so it never appears in URLs, access logs or `Referer`. `GET` with a path token was rejected for that reason.

Acceptance validates the password first (`400`, nothing consumed), hashes it, then runs one conditional update:

```
UPDATE user_invitations SET used_at = now
 WHERE token_digest = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now
 RETURNING user_id
```

followed, in the same transaction, by setting `users.password_hash` only where it is still `NULL`. Zero rows → `404`. This makes concurrent acceptances safe without locks. Hashing before the update means a refused request still costs one bcrypt hash; acceptable at this scale and it keeps the response time similar for usable and unusable tokens.

Password rule: `z.string().min(8)` plus a refinement on `Buffer.byteLength(value, "utf8") <= 72`, because bcrypt ignores bytes past 72.

All unusable cases share one problem: `404`, title `Not Found`, detail `Invitation link is invalid or expired.`

### D8. Available ERP seller names

Registration does not trim the ERP seller name; only a blank value is rejected, and no maximum shorter than what the synchronization stores is imposed. The list excludes blank names.

`SELECT DISTINCT c.erp_seller_name FROM customers c WHERE c.erp_seller_name <> '' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.erp_seller_name = c.erp_seller_name) ORDER BY 1`. Comparison is exact, because the ERP text is the link key. Route: `GET /api/v1/users/erp-seller-names`, registered before `/:userId` routes.

### D9. Module layout and wiring

`src/modules/user-administration/`: `user-administration.schemas.ts`, `user-administration.openapi.ts`, `user-administration.router.ts` (admin routes, guard injected), `invitation.router.ts` (public routes), `user-administration.service.ts` (use cases with injected store, clock, password hasher and token generator), `user-administration.repository.ts` (Prisma), `invitation-token.ts`. `create-app.ts` mounts `/api/v1/users` with `adminGuard: createAdminSessionGuard(authenticationService)` and `/api/v1/invitations` without it. Every response is validated by its Zod schema; responses with or about tokens set `Cache-Control: no-store`.

### D9a. Response bodies (accepted by João on 2026-11-28; consumed by `s1-04-web-user-administration`)

Dates are ISO 8601 strings with offset; optional values are `null`, never omitted.

| Operation                                 | Success body                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/users`                       | `200` array of `{ id, name, email, role, erpSellerName, lastLoginAt, status, invitationExpiresAt }`; `invitationExpiresAt` is set only for `INVITED` |
| `POST /api/v1/users`                      | `201` `{ user: <list item>, invitation: { token, expiresAt } }`                                                                                      |
| `POST /api/v1/users/{userId}/invitations` | `201` `{ token, expiresAt }`                                                                                                                         |
| `GET /api/v1/users/erp-seller-names`      | `200` array of strings                                                                                                                               |
| `POST /api/v1/invitations/lookup`         | `200` `{ name, email, expiresAt }`                                                                                                                   |
| `POST /api/v1/invitations/accept`         | `204`, no body                                                                                                                                       |

Lists are plain arrays, as `GET /api/v1/sync/runs` already is.

### D10. Archive order

The `user-authentication` delta here only adds requirements to a capability created by `s1-04-user-authentication`, so that change must be archived first. `s1-04-user-authentication` task 1.4 (email decision) is answered by this change; its own spec keeps describing exact-match scenarios, which stay true for lowercase stored emails.

## Risks / Trade-offs

- [Benjamim does not accept D1] → Green of the persistence cycles is blocked; Red and the service unit tests can proceed. Fall back to alternative B only with a new spec update.
- [A future write path stores a mixed-case email] → uniqueness becomes case-sensitive again. Mitigation: the integration test asserts lowercase storage; the change summary records the rule for Benjamim's seed and any future import.
- [Token copied into a chat or ticket is reused by someone else within 48 h] → accepted risk of the "copy and deliver" decision; single use and the administrator's new-invitation action limit the window.
- [Admin loses the token right after registration] → issue a new invitation (D4); the old one stops working.
- [Seller registered before the ERP sync brings their customers] → the ERP seller name is not available yet; the administrator waits for the next synchronization (every 30 minutes) or triggers it.
- [Nullable `password_hash` surprises other modules] → today only `authentication` reads it; the Prisma type makes the `null` case a compile-time error elsewhere.

## Migration Plan

1. Benjamim agrees with D1 (task 1.3). Required before the first Green that touches persistence.
2. New migration `<timestamp>_s1_04_user_invitations`: `ALTER COLUMN password_hash DROP NOT NULL`, `CREATE TABLE user_invitations`, unique index on `token_digest`, index on `user_id` and the foreign key to `users`. Applied migrations are not edited. The seed is unchanged.
3. Rollback: corrective migration dropping `user_invitations`. Restoring `NOT NULL` is possible only after every user has a password; it is not part of the rollback.

## Open Questions

- Exact migration timestamp and whether Benjamim prefers to author the file himself; neither changes the spec or the tasks.
