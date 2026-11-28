## Why

F01 (card S1-04) requires that only the administrator lists and registers users, and that each person sets their own password through an invitation issued by the administrator, with no self-registration. Sign-in, identity and administrator authorization already exist (`s1-04-user-authentication`, `role-authorization`), but users can only come from the seed today, so the portal cannot onboard a new seller, manager or finance user.

## What Changes

- New administrator-only operations under `/api/v1/users`:
  - List users with name, email, role, ERP seller name, last access and account status (`ACTIVE`, `INVITED`, `INVITATION_EXPIRED`).
  - Register a user (name, email, role and, for sellers only, the ERP seller name). Registration returns a one-time invitation token, shown only in that response, valid for 48 hours.
  - Issue a new invitation for a user who has not set a password yet. The previous invitation stops working.
  - List the ERP seller names already synchronized from the ERP that are not linked to a user, so the administrator picks the seller instead of typing it.
- New public operations under `/api/v1/invitations`:
  - Look up an invitation by its token, returning the invited name and email.
  - Accept an invitation by setting a password (8 characters to 72 bytes). An invitation works once; a used, replaced or expired invitation is refused with the same response. Accepting does not open a session.
- Email letter case is ignored: emails are stored in lowercase at registration and sign-in looks up the lowercase form. Surrounding whitespace is not removed. This resolves the pending decision recorded in `s1-04-user-authentication` (task 1.4).
- A user who has not accepted an invitation cannot sign in; the response is the same `401` as for wrong credentials.
- One **additive** migration, pending Benjamim's agreement as owner of the schema: `users.password_hash` becomes nullable and a new `user_invitations` table stores only the digest of each invitation token. No applied migration is edited.
- Zod request/response schemas, Problem Details errors and the generated `openapi.json` are updated together.

### Out of scope / Non-goals

- Editing, deactivating or deleting users, changing a role, and password reset or change.
- Sending email or any other notification; the administrator copies and delivers the link.
- Building the invitation URL: the backend returns the token and the web client builds the link from its own origin.
- Search, filters or pagination of the user list.
- Linking synchronized customers to the new seller (`Customer.sellerId`). This belongs to the ERP synchronization (Benjamim); this change only stores `User.erpSellerName`.
- The configurable 24-hour absolute session limit.
- Invitation-specific throttling beyond the existing global rate limit.
- Removing surrounding whitespace from emails in the backend.
- Any change to the web or mobile clients (the web has its own change, `s1-04-web-user-administration`).

## Capabilities

### New Capabilities

- `user-administration`: the administrator lists users with their account status, registers users with a role and, for sellers, the ERP seller link, and issues invitations.
- `user-invitation`: an invited person looks up and accepts a one-time, 48-hour invitation by setting a password.

### Modified Capabilities

- `role-authorization`: the administrator-only operations now include the user administration operations.
- `user-authentication` (still an active change, `s1-04-user-authentication`): sign-in ignores email letter case, and a user without a password cannot sign in. Added as new requirements; `s1-04-user-authentication` must be archived before this change.

## Impact

- **Business:** the administrator can onboard the squad's users without database access; a seller is linked to the ERP seller name that defines the portfolio once the synchronization links the customers.
- **API:** six new endpoints, documented in `openapi.json`. Sign-in keeps its contract; its email lookup becomes case-insensitive. No existing response shape changes.
- **Database:** one additive migration (nullable `password_hash`; new `user_invitations` table with a unique token digest), to be agreed with Benjamim before Green. Rollback: a corrective migration that drops the table; restoring `NOT NULL` requires every user to have a password first.
- **Security:** invitation tokens come from a cryptographically secure random source, only their digest is stored, they travel only in request and response bodies (never in URLs), and responses that carry them are not cached. A used, replaced, expired or unknown invitation gets one indistinguishable response. Passwords are stored as bcrypt hashes. No new dependency.
- **Observability:** no token, password or request body is logged; existing redaction stays in force.
- **Documentation:** change summary `docs/changes/s1-04-user-administration.md` at consolidation; an ADR is evaluated there for the account activation model (nullable password plus invitation table).
