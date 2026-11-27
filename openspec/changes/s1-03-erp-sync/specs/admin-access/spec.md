## Purpose

Protects administrator-only endpoints while the login feature (F01) does not exist. It is
a stopgap with a deliberately small contract so that F01 can replace the way an
administrator is recognized without changing the endpoints that depend on it.

## ADDED Requirements

### Requirement: Administrator-only endpoints are protected

An endpoint declared administrator-only MUST answer `401` as a problem response, with a
`WWW-Authenticate: Bearer` header, when the request does not carry a valid administrator
credential. The credential is a bearer token in the `Authorization` header that equals
the configured `ADMIN_API_TOKEN`. When `ADMIN_API_TOKEN` is not configured, every
request to an administrator-only endpoint MUST be refused (the endpoints fail closed).
The token MUST be compared in constant time, MUST be at least 32 characters when
configured, and MUST NOT appear in logs, errors, or responses. A configured token that is
too short MUST make startup fail naming `ADMIN_API_TOKEN`.

#### Scenario: Valid token

- **WHEN** a request to an administrator-only endpoint carries `Authorization: Bearer <token>` with the configured token
- **THEN** the request reaches the endpoint

#### Scenario: Missing credential

- **WHEN** a request to an administrator-only endpoint carries no `Authorization` header
- **THEN** the response is `401` as a problem response with `WWW-Authenticate: Bearer`

#### Scenario: Wrong token

- **WHEN** a request carries a bearer token that differs from the configured one, even by one character or in length
- **THEN** the response is `401` and the endpoint is not reached

#### Scenario: Other schemes are refused

- **WHEN** a request carries `Authorization: Basic <value>` or a bearer value with extra parts
- **THEN** the response is `401`

#### Scenario: Token not configured

- **WHEN** the backend runs without `ADMIN_API_TOKEN` and a request carries any bearer token
- **THEN** the response is `401` and the endpoint is not reached

#### Scenario: Token too short

- **WHEN** the backend starts with an `ADMIN_API_TOKEN` of fewer than 32 characters
- **THEN** startup fails with an error naming `ADMIN_API_TOKEN` and not showing its value

#### Scenario: The token is never logged

- **WHEN** a request with a valid or an invalid token is handled
- **THEN** the token value appears in no log line and no response body

### Requirement: Replaceable recognition of administrators

The decision that a request comes from an administrator MUST be made by one replaceable
component, so that an authenticated session with the `ADMIN` role can take its place
without changing any administrator-only endpoint or its tests.

#### Scenario: A different recognizer is plugged in

- **WHEN** an administrator-only endpoint is built with a recognizer that accepts a given request
- **THEN** that request reaches the endpoint, and any request the recognizer refuses gets `401`
