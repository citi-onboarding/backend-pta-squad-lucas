# admin-access Specification

## Purpose

Protects administrator-only endpoints through one replaceable guard, so that the way an
administrator is recognized can change without changing the endpoints that depend on it.
Who is an administrator is defined by the `role-authorization` capability.

## Requirements

### Requirement: Administrator-only endpoints are protected

An endpoint declared administrator-only MUST apply the access rules of the
`role-authorization` capability (change `s1-04-role-authorization`): which session and role
are accepted, how unauthenticated (`401`) and forbidden (`403`) requests are answered, and
that refusals and failures expose no credential or internal detail. This capability does not
restate those rules. The static `ADMIN_API_TOKEN` MUST NOT grant access.

#### Scenario: A refused request does not reach the endpoint

- **WHEN** a request that `role-authorization` refuses is made to an administrator-only endpoint
- **THEN** it is answered as that capability defines and the endpoint is not reached

### Requirement: Legacy administrator token setting is still validated

`ADMIN_API_TOKEN` is an optional legacy setting that the backend still reads. When
configured it MUST be at least 32 characters, a shorter value MUST make startup fail naming
`ADMIN_API_TOKEN`, and its value MUST NOT appear in logs, errors, or responses.

#### Scenario: Token too short

- **WHEN** the backend starts with an `ADMIN_API_TOKEN` of fewer than 32 characters
- **THEN** startup fails with an error naming `ADMIN_API_TOKEN` and not showing its value

### Requirement: Replaceable recognition of administrators

The decision that a request comes from an administrator MUST be made by one replaceable
guard, given to the endpoints from outside, so that it can be replaced without changing any
administrator-only endpoint.

#### Scenario: A different guard is plugged in

- **WHEN** the administrator-only endpoints are built with another guard
- **THEN** a request the guard accepts reaches the endpoint, and a request it refuses is answered by the guard without reaching the endpoint
