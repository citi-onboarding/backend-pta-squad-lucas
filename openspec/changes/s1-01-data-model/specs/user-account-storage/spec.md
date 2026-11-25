## Purpose

Defines how user accounts, their roles, their last access and their sessions are stored, and which test users exist after seeding, so that login and the users screen can be built on top of it.

## ADDED Requirements

### Requirement: Closed user roles

The system SHALL accept only the roles `SELLER`, `MANAGER`, `FINANCE` and `ADMIN`.

#### Scenario: Valid role is accepted

- **WHEN** a user is saved with role `MANAGER`
- **THEN** the user is stored with that role

#### Scenario: Unknown role is rejected

- **WHEN** a user is saved with a role outside the list
- **THEN** the save is rejected

### Requirement: Unique e-mail

The system SHALL keep each user e-mail unique.

#### Scenario: Duplicate e-mail is rejected

- **WHEN** a user is saved with an e-mail that another user already has
- **THEN** the save is rejected

### Requirement: Password stored only as a hash

The system SHALL store only a hash of each password, never the password itself.

#### Scenario: Seeded passwords are hashes

- **WHEN** the database is seeded
- **THEN** no stored password value equals the plain test password, and the plain password matches its stored hash when verified

### Requirement: Seller ERP name and last access

The system SHALL keep, for each seller, the name the seller has in the ERP, and SHALL keep for every user the date of the last access, which may be empty before the first access.

#### Scenario: Seller keeps ERP name

- **WHEN** a seller is saved with an ERP name
- **THEN** reading the seller returns that ERP name

#### Scenario: Seller ERP name is unique

- **WHEN** a second seller is saved with an ERP name that another seller already has
- **THEN** the save is rejected

#### Scenario: New user has no last access

- **WHEN** a user is saved without a last-access date
- **THEN** the last access is empty

### Requirement: Sessions

The system SHALL record sessions of a user with their creation time, last use time and end time, and SHALL allow a user to have several sessions.

#### Scenario: Session of a user is recorded

- **WHEN** a session is saved for an existing user
- **THEN** reading the user's sessions returns it with an empty end time

#### Scenario: Session ends

- **WHEN** a session is given an end time
- **THEN** reading it returns that end time

#### Scenario: Session of a missing user is rejected

- **WHEN** a session is saved for a user that does not exist
- **THEN** the save is rejected

### Requirement: Test users from the prototype

The system SHALL provide, after seeding, one test user for each of the 8 people of the prototype, with e-mail in the form `firstname@distrilux.com.br`: sellers Patrícia Lins, Juliana Freitas, Carla Menezes, Rodrigo Albuquerque and Marcos Viana; manager Fernanda Cavalcanti; finance user Sérgio Barros; and administrator Lucas Moura.

#### Scenario: Seed creates all test users

- **WHEN** the database is created from scratch and seeded
- **THEN** 8 test users exist, covering the roles `SELLER` (5), `MANAGER`, `FINANCE` and `ADMIN`

#### Scenario: Seed is repeatable

- **WHEN** the seed runs twice
- **THEN** there are still exactly 8 test users
