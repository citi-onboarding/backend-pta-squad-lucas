## Purpose

Lets a registered user sign in with email and password, prove their identity on later requests through a session credential suited to their client, and sign out, so that every Sprint 1 feature can rely on a known, revocable session.

## ADDED Requirements

### Requirement: Seller session lifecycle

The system SHALL let a registered seller sign in with valid credentials, read the identity of the resulting session, sign out, and SHALL reject the same credential on every request after sign-out.

#### Scenario: Seller signs in, reads identity, signs out and is rejected afterwards

- **GIVEN** a registered user with role `SELLER`, an ERP seller name and a known password
- **WHEN** the mobile client signs in with that email exactly as registered and that password
- **AND** reads the session identity with the delivered credential as a Bearer token
- **AND** signs out with the same credential
- **AND** reads the session identity again with the same credential
- **THEN** sign-in returns `200`, the first identity read returns `200` with role `SELLER` and the user's ERP seller name, sign-out returns `204`, and the second identity read returns `401` as Problem Details

### Requirement: Sign-in with email and password

The system SHALL open a new session when the submitted email is exactly a registered user's email, as registered, and the submitted password matches that user's stored password. Each successful sign-in SHALL open a distinct session and SHALL record the sign-in time as the user's last login date. This change does not define the outcome for an email that differs from a registered email only in letter case or surrounding whitespace; that behavior is a pending product decision and no scenario of this change asserts it.

#### Scenario: Valid credentials open a session

- **WHEN** a registered user signs in with their email exactly as registered and the correct password
- **THEN** the response is `200` and contains the user's identity

#### Scenario: Last login date is recorded

- **GIVEN** a registered user whose last login date is empty
- **WHEN** the user signs in successfully
- **THEN** the user's last login date is set to the sign-in time

#### Scenario: Two sign-ins open two independent sessions

- **WHEN** the same user signs in twice and signs out with the first credential
- **THEN** the second credential still reads the identity with `200`

### Requirement: Identical rejection of invalid credentials

The system SHALL reject a sign-in with an unknown email and a sign-in with a wrong password with the same `401` Problem Details response, whose status, title, detail and type are identical, SHALL NOT reveal which part was wrong, SHALL NOT open a session and SHALL NOT change the user's last login date.

#### Scenario: Unknown email is rejected

- **WHEN** a client signs in with a well-formed email that is not registered and is not a letter-case or whitespace variant of a registered email
- **THEN** the response is `401` Problem Details and no credential is delivered

#### Scenario: Wrong password is rejected

- **WHEN** a client signs in with a registered email exactly as registered and a wrong password
- **THEN** the response is `401` Problem Details, no credential is delivered and the user's last login date is unchanged

#### Scenario: Both rejections are indistinguishable

- **WHEN** a client signs in once with an unknown email and once with a registered email exactly as registered and a wrong password
- **THEN** both responses have the same status, content type, title, detail and type

#### Scenario: Unknown email still performs a password comparison

- **WHEN** a client signs in with a well-formed email that is not registered and is not a letter-case or whitespace variant of a registered email
- **THEN** the submitted password is compared once against a bcrypt hash that belongs to no user, with the same cost as stored password hashes, and the response is `401`

### Requirement: Sign-in request validation

The system SHALL reject a sign-in request whose body is not an object with an email, a non-empty password and a client type of `web` or `mobile`, with `400` validation Problem Details, and SHALL NOT open a session. Letter-case and surrounding-whitespace variants of an email are not classified by this requirement (see the pending product decision in "Sign-in with email and password").

#### Scenario: Malformed request is rejected

- **WHEN** a client signs in with a missing password, an email value without `@` (for example `not-an-email`), an unknown client type or an unexpected property
- **THEN** the response is `400` validation Problem Details and no credential is delivered

#### Scenario: Unparseable body is rejected without being logged

- **WHEN** a client sends a sign-in body that is not parseable JSON and contains a password, while logs are captured
- **THEN** the response is `400` Problem Details, no credential is delivered, and the captured logs contain neither the password nor the body

### Requirement: Credential delivery to web clients

For a web client, the system SHALL deliver the session credential only in a cookie that is `HttpOnly`, `Secure` and `SameSite=Strict`, and SHALL NOT include the credential anywhere in the response body. Requests from a web client SHALL be authenticated by that cookie.

#### Scenario: Web sign-in sets the cookie and keeps the body free of the credential

- **WHEN** a web client signs in with valid credentials
- **THEN** the response sets the session cookie with `HttpOnly`, `Secure`, `SameSite=Strict` and `Path=/`, and the response body contains the identity but not the cookie value

#### Scenario: Web client reads identity with the cookie

- **GIVEN** a web client that signed in
- **WHEN** it reads the session identity sending only the session cookie
- **THEN** the response is `200` with the user's identity and contains no credential

#### Scenario: Web sign-out clears the cookie

- **GIVEN** a web client that signed in
- **WHEN** it signs out with the session cookie
- **THEN** the response is `204` and expires the session cookie, and reading the identity again with the old cookie value returns `401`

### Requirement: Credential delivery to the mobile app

For a mobile client, the system SHALL deliver the session credential in the sign-in response body with token type `Bearer`, SHALL NOT set a session cookie, and SHALL authenticate requests that send it as `Authorization: Bearer <credential>`. When a request carries an `Authorization` header, the system SHALL authenticate only by that header.

#### Scenario: Mobile sign-in returns a Bearer credential

- **WHEN** a mobile client signs in with valid credentials
- **THEN** the response body contains the identity, a non-empty access token and token type `Bearer`, and no `Set-Cookie` header is sent

#### Scenario: Malformed authorization header is rejected

- **WHEN** a client reads the session identity with an `Authorization` header that is not a well-formed Bearer credential
- **THEN** the response is `401` Problem Details, even if a valid session cookie is also sent

### Requirement: Identity and credential responses are not cached

Every successful response that carries the session identity or a session credential, namely web sign-in, mobile sign-in and reading the session identity, SHALL carry the header `Cache-Control: no-store`.

#### Scenario: Successful responses forbid caching

- **WHEN** a web or mobile client signs in successfully, or reads the session identity successfully with a cookie or a Bearer credential
- **THEN** each response carries `Cache-Control: no-store`

### Requirement: Documented authentication errors

The published API description SHALL declare, for the `400` and `401` responses of sign-in and the `401` responses of reading the session identity and signing out, the media type `application/problem+json` with the Problem Details schema, whose required properties are `type`, `title`, `status`, `detail`, `instance` and `requestId`.

#### Scenario: Error responses reference Problem Details

- **WHEN** a client reads the published API description
- **THEN** each of those responses declares `application/problem+json` with the Problem Details schema

### Requirement: Session identity

The system SHALL return, for a valid session, the user's id, name, email and role, and the ERP seller name, which SHALL be the stored ERP seller name for a seller and `null` for a user without one. The response SHALL NOT contain the password hash, the credential or session internals.

#### Scenario: Seller identity includes the ERP seller name

- **WHEN** a seller with ERP seller name reads the session identity
- **THEN** the response is `200` with role `SELLER` and that ERP seller name

#### Scenario: Non-seller identity has no ERP seller name

- **WHEN** a user with role `MANAGER` reads the session identity
- **THEN** the response is `200` with role `MANAGER` and ERP seller name `null`

#### Scenario: Identity never exposes secrets

- **WHEN** any user reads the session identity
- **THEN** the response contains no password hash, no credential and no session timestamps

### Requirement: Authentication required

The system SHALL reject reading the session identity and signing out with `401` Problem Details when no credential is sent, or when the credential is unknown, belongs to an ended session or belongs to an expired session. All these rejections SHALL be indistinguishable. Every `401` response to reading the session identity or signing out SHALL carry the header `WWW-Authenticate: Bearer`.

#### Scenario: Rejections announce the authentication scheme

- **WHEN** a client reads the session identity or signs out with a missing, unknown, malformed or ended-session credential
- **THEN** each `401` response carries `WWW-Authenticate: Bearer`

#### Scenario: Missing credential is rejected

- **WHEN** a client reads the session identity without any credential
- **THEN** the response is `401` Problem Details

#### Scenario: Unknown credential is rejected

- **WHEN** a client reads the session identity with a credential that was never issued
- **THEN** the response is `401` Problem Details identical to the missing-credential response

#### Scenario: Sign-out without a valid credential is rejected

- **WHEN** a client signs out without a credential or with an unknown one
- **THEN** the response is `401` Problem Details

### Requirement: Sliding 8-hour expiry

The system SHALL treat a session as expired when 8 hours or more have passed since its last valid use, and SHALL renew the last use on every successfully authenticated request. Renewing the last use SHALL NOT change the user's last login date. A request rejected as unauthenticated SHALL NOT renew the session. A request with a valid session that is refused only because of the user's role is authenticated, so it renews the session.

#### Scenario: Session used within 8 hours stays valid

- **GIVEN** a session whose last valid use was 7 hours and 59 minutes ago
- **WHEN** the client reads the session identity
- **THEN** the response is `200` and the session's last use becomes the current time

#### Scenario: Session idle for 8 hours expires

- **GIVEN** a session whose last valid use was exactly 8 hours ago
- **WHEN** the client reads the session identity
- **THEN** the response is `401` Problem Details

#### Scenario: Activity keeps the session alive beyond 8 hours from sign-in

- **GIVEN** a session signed in 10 hours ago and last used 1 hour ago
- **WHEN** the client reads the session identity
- **THEN** the response is `200`

#### Scenario: Activity does not change the last login date

- **GIVEN** a user who signed in
- **WHEN** the user reads the session identity later
- **THEN** the user's last login date still equals the sign-in time

### Requirement: Immediate sign-out

The system SHALL end the current session on sign-out, effective for the very next request, and SHALL NOT end other sessions of the same user.

#### Scenario: Ended session is rejected immediately

- **WHEN** a client signs out and immediately reads the session identity with the same credential
- **THEN** the response is `401` Problem Details

#### Scenario: Repeated sign-out is rejected

- **WHEN** a client signs out twice with the same credential
- **THEN** the first response is `204` and the second is `401` Problem Details

### Requirement: Credential secrecy

The system SHALL generate each credential from a cryptographically secure random source with at least 256 bits of entropy, SHALL store only a one-way digest of it, and SHALL NOT write passwords, credentials, cookies or authorization headers to logs.

#### Scenario: Stored session does not contain the credential

- **WHEN** a user signs in and the stored session is read
- **THEN** no stored session value equals the delivered credential

#### Scenario: Credentials are unique per sign-in

- **WHEN** the same user signs in twice
- **THEN** the two delivered credentials are different

#### Scenario: Logs do not contain secrets

- **WHEN** a user signs in, reads the identity and signs out while logs are captured
- **THEN** the captured logs contain neither the password, the credential, nor the cookie or authorization header values

### Requirement: No ERP dependency

The system SHALL sign in, read the identity and sign out using only locally stored data, without contacting the ERP.

#### Scenario: Authentication works without the ERP

- **GIVEN** the ERP is unreachable
- **WHEN** a seller signs in and reads the session identity
- **THEN** both responses succeed and include the locally stored ERP seller name
