## ADDED Requirements

### Requirement: Operations restricted to declared roles

An operation restricted by role SHALL declare one or more allowed roles among `SELLER`, `MANAGER`, `FINANCE` and `ADMIN`. It SHALL be performed only for a request authenticated by a valid session of a user whose role is one of them, with the session credential accepted and resolved as for reading the session identity. A request without a valid session SHALL get `401` Problem Details with `WWW-Authenticate: Bearer` and SHALL NOT renew any session. A valid session of a user with any other role SHALL get `403` Problem Details and SHALL count as session use: it renews the session's last use and does not change the last login date. When the system cannot decide, it SHALL answer `500` Problem Details without internal detail or credentials. A refused or undecided request SHALL NOT perform the operation.

#### Scenario: The only declared role is allowed

- **GIVEN** an operation restricted to `MANAGER`
- **WHEN** a user with role `MANAGER` calls it with a valid session, by Bearer credential or by session cookie
- **THEN** the operation is performed

#### Scenario: Any of several declared roles is allowed

- **GIVEN** an operation restricted to `MANAGER` and `FINANCE`
- **WHEN** a user with role `MANAGER` and then a user with role `FINANCE` call it with valid sessions
- **THEN** the operation is performed for both

#### Scenario: A role that is not declared is forbidden

- **GIVEN** an operation restricted to `MANAGER` and `FINANCE`, and `SELLER` and `ADMIN` users who signed in one hour ago
- **WHEN** each of them calls it
- **THEN** the response is `403` Problem Details, the session's last use becomes the current time, the last login date is still the sign-in time and the operation is not performed

#### Scenario: No valid session

- **GIVEN** an operation restricted to `MANAGER`
- **WHEN** it is requested without a credential, with an unknown credential, and with the credential of a manager session idle for 8 hours
- **THEN** every response is `401` Problem Details with `WWW-Authenticate: Bearer`, the idle session's last use is unchanged and the operation is not performed

#### Scenario: The decision cannot be made

- **WHEN** the stored sessions cannot be read while a restricted operation is requested
- **THEN** the response is `500` Problem Details without internal detail and the operation is not performed

### Requirement: Identity available to the allowed operation

An allowed operation SHALL receive the identity of the user whose session authorized the request: the user id, the role and the ERP seller name, which is empty for a user who has none. The operation SHALL obtain it from that same authorization, without resolving the credential again. An operation that expects the identity but was not restricted by role SHALL fail with `500` Problem Details instead of running without a user.

#### Scenario: Seller identity reaches the operation

- **GIVEN** an operation restricted to `SELLER`
- **WHEN** a seller linked to an ERP seller name calls it with a valid session
- **THEN** the operation receives that seller's id, the role `SELLER` and that ERP seller name, and the session is checked once

#### Scenario: Identity without ERP seller name

- **GIVEN** an operation restricted to `MANAGER`
- **WHEN** a manager calls it with a valid session
- **THEN** the operation receives the manager's id, the role `MANAGER` and an empty ERP seller name

#### Scenario: Identity expected without a role restriction

- **WHEN** an operation that expects the identity is requested and no role restriction ran for it
- **THEN** the response is `500` Problem Details and the operation does not continue
