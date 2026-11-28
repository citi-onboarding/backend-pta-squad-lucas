## Purpose

Defines which signed-in users may call administrator-only operations and how every other request is refused, so that access follows the identity and role of a revocable session.

## ADDED Requirements

### Requirement: Administrator operations require an administrator session

Listing synchronization runs (`GET /api/v1/sync/runs`) and starting a manual synchronization (`POST /api/v1/sync/run`) SHALL be performed only for a request authenticated by a valid session of a user with role `ADMIN`. The session credential SHALL be accepted and resolved as for reading the session identity: a present `Authorization` header is the only source, otherwise the session cookie is used. Success payloads, query validation and conflict responses of both operations SHALL be unchanged. A static administrator token SHALL NOT grant access, whether or not it is configured.

#### Scenario: Administrator with a Bearer credential

- **WHEN** a user with role `ADMIN` signs in as a mobile client and calls each operation with the Bearer credential
- **THEN** listing answers `200` with the run list and starting answers `202` with the started run

#### Scenario: Administrator with the session cookie

- **WHEN** a user with role `ADMIN` signs in as a web client and calls each operation sending only the session cookie
- **THEN** listing answers `200` and starting answers `202`

#### Scenario: Static token no longer grants access

- **WHEN** a request carries the configured static administrator token as a Bearer credential
- **THEN** both operations answer `401` and no synchronization operation is performed

### Requirement: Requests without a valid session are unauthenticated

The system SHALL answer `401` Problem Details with `WWW-Authenticate: Bearer`, and SHALL NOT perform the operation, when a request to an administrator operation has no credential, a malformed or unknown credential, or a credential of an ended or expired session.

#### Scenario: Missing, invalid or expired session

- **WHEN** each administrator operation is requested without a credential, with a malformed or unknown credential, with the credential of a signed-out session, and with the credential of a session idle for 8 hours
- **THEN** every response is `401` Problem Details with `WWW-Authenticate: Bearer` and no synchronization operation is performed

#### Scenario: Invalid header is not replaced by the cookie

- **WHEN** a request carries an invalid `Authorization` header and a valid administrator cookie
- **THEN** the response is `401` and no synchronization operation is performed

### Requirement: Other roles are forbidden

The system SHALL answer `403` Problem Details, and SHALL NOT perform the operation, when a request to an administrator operation carries a valid session of a user whose role is `SELLER`, `MANAGER` or `FINANCE`.

#### Scenario: Non-administrator session

- **WHEN** a user with role `SELLER`, `MANAGER` or `FINANCE` calls either administrator operation with a valid session
- **THEN** the response is `403` Problem Details and no synchronization operation is performed

### Requirement: A forbidden request still counts as session use

A valid session of a user whose role is refused SHALL be authenticated: the request SHALL renew the session's last use, SHALL NOT change the user's last login date and SHALL NOT perform the operation. A request rejected as unauthenticated SHALL NOT renew any session.

#### Scenario: Forbidden request renews the session

- **GIVEN** a `SELLER`, `MANAGER` or `FINANCE` user who signed in one hour ago
- **WHEN** the user calls an administrator operation
- **THEN** the response is `403`, the session's last use becomes the current time, the last login date is still the sign-in time and no synchronization operation is performed

#### Scenario: Unauthenticated request does not renew

- **WHEN** an administrator operation is requested with the credential of a session idle for 8 hours
- **THEN** the response is `401` and the session's last use is unchanged

### Requirement: Failure while authorizing denies access

When the system cannot decide whether a request comes from an administrator, it SHALL NOT perform the operation and SHALL answer `500` Problem Details without internal detail or credentials.

#### Scenario: Session lookup fails

- **WHEN** the stored sessions cannot be read while an administrator operation is requested
- **THEN** the response is `500` Problem Details, without internal detail, and no synchronization operation is performed

### Requirement: Documented administrator access

The published API description SHALL declare for both administrator operations the Bearer and session-cookie security schemes, and `401` and `403` responses with the Problem Details schema.

#### Scenario: API description

- **WHEN** a client reads the published API description
- **THEN** both operations declare those security schemes and responses, and the synchronization status operation declares no security
