## Why

The only role protection F01 offers is fixed to `ADMIN` and does not tell the protected route who is signed in. Other features of the sprint need to restrict operations to other roles (the contract list is for managers only) and to know the signed-in user (a seller sees only their own portfolio, RN-08). Without one shared protection, each of them would repeat session and role checks.

## What Changes

- A protected operation declares the roles allowed to use it. One or more of `SELLER`, `MANAGER`, `FINANCE` and `ADMIN` can be declared.
- Refusals keep the rules already used for administrator operations: `401` with `WWW-Authenticate: Bearer` without a valid session, `403` for a role that is not allowed (the session use is renewed), and `500` without internal detail when the system cannot decide.
- An allowed operation receives the identity of the signed-in user (id, role and ERP seller name), resolved from the same session check.
- The administrator synchronization and user administration operations use this protection with `ADMIN` as the only allowed role. The fixed administrator protection is removed.
- The `403` explanation text becomes the same for every protected operation instead of naming the administrator role.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `role-authorization`: adds requirements for operations restricted to a declared set of roles and for the identity available to an allowed operation. The existing administrator requirements keep their text and scenarios.

## Impact

- **Business:** features restricted to managers, finance or sellers can be protected consistently; no user gains or loses access in this change.
- **Security:** one single place decides access. The decision order is unchanged: authentication first, which renews the session, then the role. An operation never runs when the decision fails.
- **API:** no route, status, payload or `openapi.json` change. Only the `detail` text of the `403` Problem Details changes.
- **Database:** none. No migration.
- **Observability:** none. The identity is not logged.
- **Documentation:** change summary. No new ADR: the session and the composition of guards in `src/app` are covered by ADR-0004.

**In scope:** the role protection, the identity it hands to the operation, and moving the six existing administrator operations to it.

**Out of scope (non-goals):** protecting new operations (contracts belong to F21), filtering data by seller portfolio, filling `Customer.sellerId`, role hierarchy or per-permission rules, changing which roles may use any existing operation, and the web and mobile applications.

**Dependencies:** builds on `s1-04-user-authentication` and `s1-04-user-administration`, both still active.
