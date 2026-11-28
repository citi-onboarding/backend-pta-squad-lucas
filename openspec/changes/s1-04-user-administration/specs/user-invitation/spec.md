## Purpose

Lets a person invited by the administrator confirm who the invitation is for and set their own password once, within 48 hours, so that they can then sign in.

## ADDED Requirements

### Requirement: Invitation lookup

The system SHALL let anyone holding an invitation token, without a session, look it up. For a usable invitation, the response SHALL be `200` with the invited user's name and email and the expiry date. An invitation is usable when it exists, has not been used, has not been replaced by a newer invitation, and less than 48 hours have passed since it was issued. Looking up an invitation SHALL NOT consume it.

#### Scenario: Usable invitation is found

- **GIVEN** an invitation issued 1 hour ago
- **WHEN** a client looks it up with its token
- **THEN** the response is `200` with the invited name, email and expiry date, and the invitation can still be accepted

#### Scenario: Unusable invitations are indistinguishable

- **WHEN** a client looks up, in turn, an unknown token, a used invitation, a replaced invitation and an invitation issued exactly 48 hours ago
- **THEN** each response is `404` Problem Details with the same title and detail

### Requirement: Invitation acceptance

The system SHALL let anyone holding a usable invitation token, without a session, set the invited user's password. The password SHALL have at least 8 characters and at most 72 bytes in UTF-8. On success the system SHALL store only a hash of the password, mark the invitation as used and answer `204`; it SHALL NOT open a session. An invitation SHALL be accepted at most once, also under concurrent requests. A request for an unusable invitation SHALL get the same `404` as an unusable lookup and SHALL NOT change any password.

#### Scenario: Invited person sets a password and signs in

- **GIVEN** a user registered as `MANAGER` with a usable invitation
- **WHEN** the client accepts the invitation with password `distrilux-2026` and then signs in with that email and password
- **THEN** acceptance answers `204` without a session credential, the sign-in answers `200`, and the user's status becomes `ACTIVE`

#### Scenario: Second use is refused

- **GIVEN** an invitation that was already accepted
- **WHEN** a client accepts it again with another password
- **THEN** the response is `404` Problem Details and the password set by the first acceptance still signs in

#### Scenario: Acceptance just before expiry

- **GIVEN** an invitation issued 47 hours and 59 minutes ago, with the clock controlled by the test
- **WHEN** a client accepts it with a valid password
- **THEN** the response is `204`

#### Scenario: Acceptance after expiry

- **GIVEN** an invitation issued exactly 48 hours ago, with the clock controlled by the test
- **WHEN** a client accepts it with a valid password
- **THEN** the response is `404` Problem Details and the user still has no password

#### Scenario: Concurrent acceptances

- **WHEN** two acceptances of the same usable invitation are sent at the same time with different passwords
- **THEN** exactly one answers `204`, the other answers `404`, and only the password of the successful one signs in

#### Scenario: Password too short or too long

- **WHEN** a client accepts a usable invitation with a 7-character password, or with a password longer than 72 bytes in UTF-8
- **THEN** the response is `400` validation Problem Details and the invitation remains usable

#### Scenario: Malformed request

- **WHEN** a client sends an acceptance or lookup without a token, with a token that is not a string, or with an unexpected property
- **THEN** the response is `400` validation Problem Details

### Requirement: Invitation token secrecy

The system SHALL generate each invitation token from a cryptographically secure random source with at least 256 bits of entropy, SHALL store only a digest of it, and SHALL accept it only in request bodies, never in a URL path or query. Responses that carry or check a token SHALL NOT be cached. No token or password SHALL be written to logs.

#### Scenario: Only the digest is stored

- **WHEN** an administrator registers a user and receives the invitation token
- **THEN** no stored value equals the token, and the stored digest identifies the invitation

#### Scenario: Invitation responses are not cached

- **WHEN** a client looks up or accepts an invitation
- **THEN** the response carries `Cache-Control: no-store`

#### Scenario: Token and password are not logged

- **WHEN** a client accepts an invitation
- **THEN** the captured logs contain neither the token nor the password
