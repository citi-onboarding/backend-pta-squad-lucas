## Purpose

Defines how a customer's supply contract is stored, with its end date and notice period, so that the contract situation can be computed when needed instead of being stored.

## ADDED Requirements

### Requirement: Contract terms

The system SHALL store, for each contract, its number, customer, start date, end date, notice days, automatic-renewal flag, payment terms, minimum monthly volume in cents, whether it has an amendment, and the path of its document file.

#### Scenario: Contract is stored with its terms

- **WHEN** a contract is saved for an existing customer with all terms
- **THEN** reading it returns the same terms, including the minimum volume in whole cents

#### Scenario: Contract of a missing customer is rejected

- **WHEN** a contract is saved for a customer that does not exist
- **THEN** the save is rejected

#### Scenario: Duplicate contract number is rejected

- **WHEN** a contract is saved with a number that another contract already has
- **THEN** the save is rejected

### Requirement: Contract situation is not stored

The system SHALL NOT store the contract situation; the situation SHALL be derived from the end date and notice days at the time it is needed.

#### Scenario: Stored contract has no situation value

- **WHEN** a contract is read
- **THEN** it contains the end date and notice days, and no stored situation value

### Requirement: Contract document path is optional

The system SHALL allow a contract to be stored without a document file path.

#### Scenario: Contract without document

- **WHEN** a contract is saved without a document path
- **THEN** the contract is stored with an empty document path
