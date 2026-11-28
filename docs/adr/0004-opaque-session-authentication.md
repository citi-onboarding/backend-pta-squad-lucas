---
title: ADR-0004
status: proposed
date: 2026-11-27
owners: [João]
tags: [security, authentication, session, api, sprint-1]
supersedes: null
superseded_by: null
---

# 0004: Opaque session tokens for authentication, delivered per client

## Context

Sprint 1 needs authentication for two clients: the web application, running in a browser, and the field app (F16). Every later feature (RBAC, portfolios, orders) will depend on the identity this produces, so the credential model is hard to change once clients ship. Requirements from the card S1-04 and the PRD: email/password sign-in against the bcrypt hashes stored by `s1-01-data-model`, immediate revocation on sign-out, expiry 8 hours after the last use with valid activity renewing it, no credential readable by browser JavaScript or written to logs, the same `401` for an unknown email and a wrong password, and no client talking to the ERP. A configurable absolute maximum of 24 hours is expected later, but its activation depends on Lucas and the client.

The data model already has a `Session` table (user, creation, last use, end) but no column able to identify a session from a credential.

The S1-04 card foresaw `jsonwebtoken` (confirmed by João). Both options then weighed kept a `Session` row: "JWT with `Session`" and "opaque token with `Session`". On 2026-11-27 João answered "vamos usar token opaco".

## Decision

**Scope of approval.** Only the credential type — an opaque token bound to `Session` instead of a JWT — was decided, by João, on 2026-11-27. Every other point below (storage, delivery per client, lifetime, errors and the boundary rule) is proposed and has not been accepted by João or reviewed by the squad. The ADR as a whole therefore stays `proposed` until it is accepted under `docs/adr/README.md`.

- **Credential:** an opaque value of 256 bits from a cryptographically secure random source, encoded as base64url. It carries no claims; the server resolves it to a `Session` row on every request (credential type decided by João).
- **Storage:** only `SHA-256(credential)` is stored, in a new nullable, unique `sessions.token_digest` column added by an additive migration aligned with the schema owner (Benjamim). The credential is never persisted.
- **Delivery per client:** the sign-in request declares `client: web | mobile`.
  - `web`: the credential travels only in the `__Host-session` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`); it never appears in a response body.
  - `mobile`: the credential is returned in the body with token type `Bearer` and sent back as `Authorization: Bearer <credential>`.
  - When an `Authorization` header is present it is the only credential source; there is no fallback to the cookie.
- **Lifetime:** a session is valid while not ended and less than 8 hours have passed since its last valid use. Validation and renewal of the last use are one atomic conditional update. Sign-out sets the end time, effective on the next request. `User.lastLoginAt` changes only on sign-in; `Session.lastUsedAt` changes on every authenticated request. `Session.createdAt` is kept so an absolute maximum can be added without a new data model; it is not enforced by this decision.
- **Errors and logs:** all sign-in failures share one `401` Problem Details; all authentication failures on protected routes share another, with `WWW-Authenticate: Bearer`. Unknown emails still pay a bcrypt comparison against a dummy hash. Credentials, cookies, authorization headers, passwords and bodies are never logged.
- **Boundary rule for future changes:** the `authentication` module owns credential handling. Other modules never import it; when they need the signed-in user, `src/app` composes the guard from this module and injects the resolved principal into the request context.

## Consequences

### Positive

- Sign-out and future administrative revocation take effect immediately, with no deny list.
- A leaked database dump does not yield usable credentials; a leaked credential reveals nothing about the user.
- One server-side session model serves both clients; only the transport differs.
- Browser scripts cannot read the web credential (`HttpOnly`), and the `__Host-` prefix prevents subdomain or insecure overrides.
- The absolute 24-hour limit, renewal throttling or an HMAC-keyed digest can be added later without changing the HTTP contract.

### Negative

- Every authenticated request reads and writes the database (lookup plus renewal).
- Requires one new additive migration on a table owned by `s1-01-data-model`, which must be coordinated with Benjamim.
- `SameSite=Strict` assumes the web application and the API share a registrable domain; a different deployment topology requires a new decision with CSRF protection.
- A script already running in the web page could request the `mobile` variant; mitigated by CSP and CORS, not prevented by this decision.
- Expired session rows accumulate until a cleanup is introduced.
- Trade-off of the opaque token: the credential cannot be verified offline or by another service without access to the session store, and clients cannot read identity or expiry from it, so they must ask the API (`GET /api/v1/auth/me`). In exchange there is no signing key, no claim format to keep compatible and no data exposed in the token. This departs from the `jsonwebtoken` dependency the S1-04 card foresaw.

## Alternatives considered

### JWT with `Session` (the card's original direction)

A signed JWT carrying the session id, as foreseen in the S1-04 card with `jsonwebtoken`. It does not remove the `Session` lookup: sliding inactivity requires reading and renewing `lastUsedAt` on every request, and immediate revocation requires checking `endedAt` on every request, so the signature verification only adds work on top of the same database access. It would also add a signing key to generate, store and rotate, a new dependency, algorithm and claim validation, and claims readable by anyone holding the token. João chose the opaque token instead on 2026-11-27.

### Stateless JWT (access token, optionally with refresh token)

Immediate revocation would need a server-side deny list or very short lifetimes plus refresh tokens, which reintroduces server state with more moving parts and key management. It was not one of the two options João weighed, and it fails the immediate-revocation requirement.

### Session id (uuid) as the credential

Simpler, but anyone with read access to the database would hold live credentials, and uuid v4 provides only 122 random bits.

### Slow hash (bcrypt/argon2) of the credential

Designed for low-entropy secrets; with 256 random bits it adds latency and prevents an indexed lookup, without improving security.

### Bearer token for the web client too (stored by the web app)

Any credential readable by JavaScript is exposed to XSS; the requirement forbids it.

### Separate sign-in endpoints per client

Duplicates validation, errors and documentation for a single difference in transport.

## References

- OpenSpec change: `openspec/changes/s1-04-user-authentication/`
- Change summary: `docs/changes/s1-04-user-authentication.md` (written at consolidation)
- Related: ADR-0001 (Sprint 1 data model), `openspec/changes/s1-01-data-model/specs/user-account-storage/spec.md`
- Card S1-04 (F01), which foresaw `jsonwebtoken`; confirmed by João
- João's decision message, 2026-11-27: "vamos usar token opaco" (choice between JWT with `Session` and opaque token with `Session`)
- RFC 9457 (Problem Details), as adopted in `openspec/config.yaml` and `docs/architecture.md`
