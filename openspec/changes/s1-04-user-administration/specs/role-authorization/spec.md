## MODIFIED Requirements

### Requirement: Administrator operations require an administrator session

Listing synchronization runs (`GET /api/v1/sync/runs`), starting a manual synchronization (`POST /api/v1/sync/run`), listing users (`GET /api/v1/users`), registering a user (`POST /api/v1/users`), issuing a new invitation (`POST /api/v1/users/{userId}/invitations`) and listing available ERP seller names (`GET /api/v1/users/erp-seller-names`) SHALL be performed only for a request authenticated by a valid session of a user with role `ADMIN`. The session credential SHALL be accepted and resolved as for reading the session identity: a present `Authorization` header is the only source, otherwise the session cookie is used. Success payloads, query validation and conflict responses of the synchronization operations SHALL be unchanged. A static administrator token SHALL NOT grant access, whether or not it is configured.

#### Scenario: Administrator with a Bearer credential

- **WHEN** a user with role `ADMIN` signs in as a mobile client and calls each operation with the Bearer credential
- **THEN** listing answers `200` with the run list and starting answers `202` with the started run

#### Scenario: Administrator with the session cookie

- **WHEN** a user with role `ADMIN` signs in as a web client and calls each operation sending only the session cookie
- **THEN** listing answers `200` and starting answers `202`

#### Scenario: Static token no longer grants access

- **WHEN** a request carries the configured static administrator token as a Bearer credential
- **THEN** both operations answer `401` and no synchronization operation is performed

#### Scenario: User administration requires an administrator session

- **WHEN** each user administration operation is requested without a credential, and then with a valid session of a `SELLER`, `MANAGER` or `FINANCE` user
- **THEN** the responses are `401` with `WWW-Authenticate: Bearer` and then `403` Problem Details, and no user or invitation is created

#### Scenario: Administrator manages users with the session cookie

- **WHEN** a user with role `ADMIN` signs in as a web client and lists users sending only the session cookie
- **THEN** the response is `200` with the user list

### Requirement: Documented administrator access

The published API description SHALL declare for every administrator operation the Bearer and session-cookie security schemes, and `401` and `403` responses with the Problem Details schema.

#### Scenario: API description

- **WHEN** a client reads the published API description
- **THEN** every administrator operation declares those security schemes and responses, and the synchronization status operation and the invitation lookup and acceptance operations declare no security
