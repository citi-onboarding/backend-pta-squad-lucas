## Purpose

Lets the administrator see who can use the portal and onboard new users with a role and, for sellers, the ERP seller link, through invitations instead of self-registration.

## ADDED Requirements

### Requirement: User list with account status

The system SHALL return to an administrator every user, ordered by name, with id, name, email, role, ERP seller name (empty for non-sellers), last access date (empty before the first sign-in) and account status. The status SHALL be `ACTIVE` when the user has a password, `INVITED` when the user has no password and has an invitation that is neither used, replaced nor expired, and `INVITATION_EXPIRED` when the user has no password and no such invitation. For `INVITED` the response SHALL include the invitation expiry date. The response SHALL NOT include password hashes or invitation tokens.

#### Scenario: Seeded users are listed as active

- **GIVEN** the seeded users, none of whom has signed in
- **WHEN** an administrator lists users
- **THEN** the response is `200` with the 8 users ordered by name, each with status `ACTIVE` and an empty last access date, and sellers carry their ERP seller name

#### Scenario: Last access reflects the last sign-in

- **GIVEN** a user who signed in at a known instant
- **WHEN** an administrator lists users
- **THEN** that user's last access date equals that instant

#### Scenario: Invited user shows a pending invitation

- **GIVEN** a user registered 47 hours ago who has not accepted the invitation
- **WHEN** an administrator lists users
- **THEN** that user has status `INVITED` and the invitation expiry date is 48 hours after registration

#### Scenario: Invitation older than 48 hours shows as expired

- **GIVEN** a user registered exactly 48 hours ago who has not accepted the invitation
- **WHEN** an administrator lists users
- **THEN** that user has status `INVITATION_EXPIRED`

#### Scenario: Secrets are never listed

- **WHEN** an administrator lists users
- **THEN** no item contains a password hash, an invitation token or an invitation token digest

### Requirement: User registration with an invitation

The system SHALL let an administrator register a user with a name, an email, a role and, only when the role is `SELLER`, an ERP seller name. The name SHALL be trimmed and between 1 and 120 characters; the email SHALL be a valid address of at most 254 characters and SHALL be stored in lowercase. A registered user SHALL have no password and SHALL receive an invitation valid for 48 hours. The response SHALL be `201` with the created user (status `INVITED`) and the invitation token and expiry date; the token SHALL be returned only in this response and in the response that issues a new invitation, and the response SHALL NOT be cached. A registration refused because the email or the ERP seller name is already used SHALL answer `409` Problem Details whose `conflictField` member is `email` or `erpSellerName`.

#### Scenario: Manager is registered

- **WHEN** an administrator registers a user with role `MANAGER`, a name and a new email
- **THEN** the response is `201` with the user in status `INVITED`, an invitation token and an expiry date 48 hours after the request, and `Cache-Control: no-store`

#### Scenario: Seller is registered with an available ERP seller name

- **GIVEN** an ERP seller name present in the synchronized customers and not linked to any user
- **WHEN** an administrator registers a seller with that ERP seller name
- **THEN** the response is `201` and the user carries that ERP seller name

#### Scenario: Email is stored in lowercase

- **WHEN** an administrator registers a user with email `Nova.Pessoa@DistriLux.com.br`
- **THEN** the created user's email is `nova.pessoa@distrilux.com.br`

#### Scenario: Email already used, in any letter case

- **GIVEN** a user with email `patricia@distrilux.com.br`
- **WHEN** an administrator registers a user with email `Patricia@distrilux.com.br`
- **THEN** the response is `409` Problem Details with `conflictField` `email` and no user or invitation is created

#### Scenario: Seller without an ERP seller name

- **WHEN** an administrator registers a user with role `SELLER` and no ERP seller name
- **THEN** the response is `400` validation Problem Details and nothing is created

#### Scenario: Non-seller with an ERP seller name

- **WHEN** an administrator registers a user with role `FINANCE` and an ERP seller name
- **THEN** the response is `400` validation Problem Details and nothing is created

#### Scenario: ERP seller name not found in synchronized customers

- **WHEN** an administrator registers a seller with an ERP seller name that no synchronized customer carries
- **THEN** the response is `400` validation Problem Details and nothing is created

#### Scenario: ERP seller name already linked

- **GIVEN** a seller user linked to ERP seller name `Patrícia Lins`
- **WHEN** an administrator registers another seller with ERP seller name `Patrícia Lins`
- **THEN** the response is `409` Problem Details with `conflictField` `erpSellerName` and nothing is created

#### Scenario: Invalid registration data

- **WHEN** an administrator registers a user with a blank name, an invalid email, an unknown role or an unexpected property
- **THEN** the response is `400` validation Problem Details and nothing is created

#### Scenario: ERP seller name with surrounding spaces

- **GIVEN** an available ERP seller name that ends with a space
- **WHEN** an administrator registers a seller with exactly that name
- **THEN** the response is `201` and the user carries the name unchanged

#### Scenario: Conflict is part of the API description

- **WHEN** a client reads the published API description
- **THEN** the `409` response of user registration declares the `conflictField` member with the values `email` and `erpSellerName`

### Requirement: New invitation for a user without a password

The system SHALL let an administrator issue a new invitation for a user who has no password, whatever the state of the previous invitation. The new invitation SHALL be valid for 48 hours from its issue, and every earlier invitation of that user SHALL stop working. The response SHALL be `201` with the token and expiry date and SHALL NOT be cached. A user who already has a password SHALL get `409` and an unknown user id SHALL get `404`. These rules SHALL also hold under concurrent requests: after concurrent issues for the same user at most one invitation is usable, and an issue concurrent with an acceptance SHALL NOT leave a usable invitation for a user who has a password.

#### Scenario: Expired invitation is replaced

- **GIVEN** a user whose invitation expired
- **WHEN** an administrator issues a new invitation for that user
- **THEN** the response is `201` with a new token valid for 48 hours and the user's status becomes `INVITED`

#### Scenario: Previous invitation stops working

- **GIVEN** a user with a pending invitation A
- **WHEN** an administrator issues a new invitation B and the invited person then tries to accept A
- **THEN** accepting A is refused as an unusable invitation and accepting B succeeds

#### Scenario: Active user cannot be invited again

- **GIVEN** a user with a password
- **WHEN** an administrator issues a new invitation for that user
- **THEN** the response is `409` Problem Details and no invitation is created

#### Scenario: Concurrent new invitations

- **GIVEN** a user without a password
- **WHEN** several new invitations for that user are requested at the same time
- **THEN** exactly one invitation of that user is usable

#### Scenario: New invitation concurrent with acceptance

- **GIVEN** a user with a usable invitation
- **WHEN** that invitation is accepted at the same time as a new invitation is requested
- **THEN** either the acceptance succeeds and the user has no usable invitation, or the new invitation succeeds and the acceptance is refused as unusable

#### Scenario: Unknown user

- **WHEN** an administrator issues an invitation for a well-formed id that matches no user
- **THEN** the response is `404` Problem Details

### Requirement: Available ERP seller names

The system SHALL return to an administrator the distinct, non-blank ERP seller names carried by synchronized customers that are not linked to any user, in alphabetical order. Each name SHALL be returned exactly as synchronized, and registration SHALL accept every returned name unchanged, without removing surrounding spaces.

#### Scenario: Linked names are excluded

- **GIVEN** synchronized customers carrying ERP seller names `Ana Souza` and `Patrícia Lins`, and a seller user linked to `Patrícia Lins`
- **WHEN** an administrator lists available ERP seller names
- **THEN** the response is `200` with only `Ana Souza`

#### Scenario: Blank names are not offered

- **GIVEN** a synchronized customer whose ERP seller name has only spaces
- **WHEN** an administrator lists available ERP seller names
- **THEN** that name is not in the list

#### Scenario: No synchronized customers

- **GIVEN** no synchronized customer
- **WHEN** an administrator lists available ERP seller names
- **THEN** the response is `200` with an empty list
