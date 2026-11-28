## ADDED Requirements

### Requirement: Sign-in ignores email letter case

The system SHALL compare the submitted email with registered emails ignoring letter case, so that an email differing from a registered one only in letter case signs in that user. Surrounding whitespace SHALL NOT be removed: an email with surrounding whitespace is not a registered email. An unknown email in any letter case SHALL get the same `401` as any other invalid credential.

#### Scenario: Uppercase variant signs in

- **GIVEN** a user registered with email `patricia@distrilux.com.br`
- **WHEN** the user signs in with `Patricia@DistriLux.com.br` and the correct password
- **THEN** the response is `200` with that user's identity and email `patricia@distrilux.com.br`

#### Scenario: Uppercase variant with a wrong password

- **GIVEN** a user registered with email `patricia@distrilux.com.br`
- **WHEN** a client signs in with `PATRICIA@distrilux.com.br` and a wrong password
- **THEN** the response is the same `401` Problem Details as for an unknown email

#### Scenario: Surrounding whitespace is not removed

- **GIVEN** a user registered with email `patricia@distrilux.com.br`
- **WHEN** a client signs in with that email preceded and followed by one space, and the correct password
- **THEN** no session is opened and the response is not `200`

### Requirement: Users without a password cannot sign in

The system SHALL reject the sign-in of a user who has not set a password through an invitation with the same `401` Problem Details as for an unknown email, whatever password is submitted, and SHALL NOT open a session or change the last login date.

#### Scenario: Invited user tries to sign in

- **GIVEN** a user registered by an administrator who has not accepted the invitation
- **WHEN** a client signs in with that email and any password
- **THEN** the response is the same `401` Problem Details as for an unknown email, no session is opened and the last login date stays empty
