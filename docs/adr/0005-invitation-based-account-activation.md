---
title: ADR-0005
status: proposed
date: 2026-11-28
owners: [João]
tags: [security, authentication, user-administration, data-model, sprint-1]
supersedes: null
superseded_by: null
---

# 0005: Account activation through invitations, with an optional password and a digest-only token

## Context

Only the administrator registers users, and each person must set their own password; there is no self-registration (card S1-04). Until this change, users came only from the seed, with a bcrypt hash that `users.password_hash` required. The portal needs a way to onboard a seller, manager or finance user without database access, and without the administrator ever knowing the password.

The decision touches a data contract owned by another front (Benjamim owns the schema) and the sign-in rules decided in [ADR-0004](0004-opaque-session-authentication.md). Email and ERP seller uniqueness already rely on unique indexes of `users`, and the user list must show who has not finished the onboarding.

## Decision

**Scope of approval.** João accepted the design of the change on 2026-11-28. The squad, and Benjamim as owner of the schema, have not reviewed it, so this ADR stays `proposed` until it is accepted under `docs/adr/README.md`.

- A registered user is a real `users` row with `password_hash = NULL`. The migration `20261128120000_s1_04_user_invitations` makes the column nullable.
- Invitations live in a new table `user_invitations` (`user_id` with cascade, unique `token_digest`, `created_at`, `expires_at`, `used_at`, `revoked_at`; dates are `timestamp(3)`). Who issued an invitation is not stored.
- The token is 256 bits from a CSPRNG, shown only in the response that creates the invitation. Only its SHA-256 digest (base64url) is stored. It travels only in request and response bodies, never in a URL, and responses that carry it are not cached.
- An invitation is valid for 48 hours (exactly 48 hours is expired), works once, and is revoked by a newer invitation for the same user. Unknown, used, replaced and expired invitations get one indistinguishable `404`.
- Single use is guaranteed by the database: one conditional `UPDATE ... RETURNING` with the injected clock, followed in the same transaction by setting the password only where it is still null.
- Issuing and accepting an invitation both lock the user row (`SELECT ... FOR UPDATE`) before touching invitations; any new path that changes invitations or sets the first password takes the same lock first.
- The account status is computed (`ACTIVE`, `INVITED`, `INVITATION_EXPIRED`), never stored.
- Sign-in treats a user without a password like an unknown email: the same `401`, the dummy-hash comparison and no session. Emails are stored in lowercase and the service lowercases the submitted email at sign-in; future write paths must also store lowercase.
- Rules for future changes: any code that reads `password_hash` handles `null`; new invitation or credential tokens are stored only as a digest; any import or seed stores emails in lowercase.

## Consequences

### Positive

- Email and ERP seller uniqueness stay enforced by the existing unique indexes, and the list reads one table.
- A leaked database does not reveal usable invitation tokens or any password.
- Single use holds under concurrent requests without locks.

### Negative

- `users.password_hash` is nullable, so a missing case is no longer a compile error only in `authentication`; the Prisma type forces every reader to handle it.
- Case-insensitive email uniqueness depends on every write path storing lowercase; the database does not enforce it (a functional unique index on `lower(email)` cannot be represented in Prisma).
- An invitation token copied into a chat or ticket can be used by whoever holds it within 48 hours.
- Rollback needs a corrective migration that drops the table; restoring `NOT NULL` requires every user to have a password.
- The schema owner's agreement is pending and is expected at pull request review.

## Alternatives considered

### Invitation rows carrying name, email and role until acceptance

The user would be created only on acceptance. Rejected: uniqueness of email and ERP seller name would have to be checked across two tables, and people with a pending invitation would not appear as users.

### A sentinel, unusable hash in `password_hash`

Rejected: it hides the account state inside a value that is meant to be a password hash and breaks the guarantee that only real password hashes are stored.

### Token in the URL path with a `GET` lookup

Rejected: the token would reach access logs and `Referer`. Lookup and acceptance are `POST` with the token in the body.

## References

- [Change summary](../changes/s1-04-user-administration.md)
- OpenSpec change `openspec/changes/s1-04-user-administration/` (design D1 to D9)
- [ADR-0004](0004-opaque-session-authentication.md)
