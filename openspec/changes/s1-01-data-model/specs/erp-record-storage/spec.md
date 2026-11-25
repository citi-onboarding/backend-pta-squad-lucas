## Purpose

Defines how data that comes from the ERP (customers, products and receivables) and the record of each synchronization run are stored, so that repeated synchronizations update data instead of duplicating it.

## ADDED Requirements

### Requirement: ERP code uniqueness

The system SHALL keep at most one customer, one product and one receivable for each ERP code.

#### Scenario: Duplicate customer ERP code is rejected

- **WHEN** a customer is saved with an ERP code that another customer already has
- **THEN** the save is rejected and the existing customer is unchanged

#### Scenario: Duplicate product ERP code is rejected

- **WHEN** a product is saved with an ERP code that another product already has
- **THEN** the save is rejected

#### Scenario: Duplicate receivable ERP code is rejected

- **WHEN** a receivable is saved with an ERP code that another receivable already has
- **THEN** the save is rejected

#### Scenario: Same ERP record updates instead of duplicating

- **WHEN** a customer with an existing ERP code is saved through an update-or-create operation with a new name
- **THEN** exactly one customer with that ERP code exists and it has the new name

### Requirement: Money stored as integer cents

The system SHALL store every monetary value of customers, products, receivables, orders and contracts as a whole number of cents.

#### Scenario: Credit limit keeps its exact value

- **WHEN** a customer with a credit limit of R$ 12,34 is saved as 1234 cents
- **THEN** reading the customer returns 1234 cents

#### Scenario: Money fields are whole numbers by structure

- **WHEN** the database structure is inspected
- **THEN** every field that holds a monetary value is an integer type

### Requirement: Closed customer status

The system SHALL accept only the customer statuses `ACTIVE`, `BLOCKED`, `INACTIVE` and `PROSPECT`.

#### Scenario: Valid status is accepted

- **WHEN** a customer is saved with status `ACTIVE`
- **THEN** the customer is stored with that status

#### Scenario: Unknown status is rejected

- **WHEN** a customer is saved with a status outside the list
- **THEN** the save is rejected

### Requirement: Customer belongs to a seller portfolio

The system SHALL link a customer to at most one seller, and SHALL allow a customer to exist without a seller until the seller is known.

#### Scenario: Customer linked to a seller

- **WHEN** a customer is saved with an existing seller
- **THEN** the customer appears in that seller's portfolio

#### Scenario: Customer without seller is allowed

- **WHEN** a customer is saved without a seller
- **THEN** the customer is stored and its seller is empty

#### Scenario: Link to a missing seller is rejected

- **WHEN** a customer is saved with a seller that does not exist
- **THEN** the save is rejected

### Requirement: Receivable status and ownership

The system SHALL accept only the receivable statuses `PAID`, `OPEN` and `OVERDUE`, SHALL require each receivable to belong to an existing customer, and SHALL allow the payment date to be empty.

#### Scenario: Open receivable without payment date

- **WHEN** a receivable with status `OPEN` and no payment date is saved
- **THEN** the receivable is stored with an empty payment date

#### Scenario: Receivable of a missing customer is rejected

- **WHEN** a receivable is saved for a customer that does not exist
- **THEN** the save is rejected

### Requirement: Synchronization run record

The system SHALL record each synchronization run with its kind (automatic or manual), start, finish, result, number of records read, number of records changed and error detail.

#### Scenario: Finished run is recorded

- **WHEN** a synchronization run finishes with a result and counts
- **THEN** reading the run returns its kind, times, result, counts and error detail

#### Scenario: Unfinished run is allowed

- **WHEN** a run is recorded that has started but has not finished
- **THEN** the run is stored with an empty finish time
