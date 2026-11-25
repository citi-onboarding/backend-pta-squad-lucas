## Purpose

Defines how historical order items, historical receivables and data problems found in the old spreadsheets are stored, so that the historical load can run repeatedly without creating duplicates and without hiding problems.

## ADDED Requirements

### Requirement: Historical order items are loaded without duplicates

The system SHALL identify each historical order item by its order number and product code, and SHALL require the product code, so that loading the same data again does not create new items and an item that cannot be tied to a product is not stored as an order item.

#### Scenario: Repeated load does not duplicate

- **WHEN** the same set of historical order items is loaded twice
- **THEN** the number of stored items is the same after the second load

#### Scenario: Item without product code is rejected

- **WHEN** an item without a product code is saved
- **THEN** the save is rejected

#### Scenario: Same product twice in one order is rejected

- **WHEN** a second item with the same order number and product code is saved
- **THEN** the save is rejected

#### Scenario: Different products of the same order are both kept

- **WHEN** two items of the same order with different product codes are loaded
- **THEN** both are stored

### Requirement: Historical item totals and statuses

The system SHALL store, for each historical order item, a total in cents, a status of `INVOICED` or `CANCELLED`, and a record of the corrections applied to it, and SHALL allow its unit and description to be empty.

#### Scenario: Total is stored in cents

- **WHEN** an item with quantity 3 and unit price 1050 cents is stored with its total
- **THEN** reading it returns a total of 3150 cents

#### Scenario: Unknown status is rejected

- **WHEN** an item is saved with a status other than `INVOICED` or `CANCELLED`
- **THEN** the save is rejected

#### Scenario: Corrections are kept

- **WHEN** an item is stored with corrections
- **THEN** reading it returns those corrections

### Requirement: Historical receivables and reversals

The system SHALL accept the historical receivable statuses `PAID`, `OPEN`, `OVERDUE` and `REVERSED`, SHALL allow the payment date to be empty, SHALL keep a record of the corrections applied, and SHALL identify each historical receivable by its title id, so that a title and its reversal are stored as one record whose status is `REVERSED`.

#### Scenario: Reversed title is stored as one record

- **WHEN** a reversed title is stored
- **THEN** exactly one record exists for its title id, with status `REVERSED`

#### Scenario: Second record with the same title id is rejected

- **WHEN** a second record with the same title id is saved
- **THEN** the save is rejected

#### Scenario: Status change updates the same record

- **WHEN** a title already stored as `PAID` is loaded again as `REVERSED`
- **THEN** exactly one record exists and its status is `REVERSED`

#### Scenario: Open title has no payment date

- **WHEN** a title with status `OPEN` is stored without a payment date
- **THEN** it is stored with an empty payment date

### Requirement: Load issues are recorded without duplicates

The system SHALL record every data problem found during a load with its source file, row number, problem type and the load run, and SHALL keep the field, original value and resolution optional.

#### Scenario: Whole-row problem without field

- **WHEN** a problem about an entire row is recorded without field, original value or resolution
- **THEN** it is stored with those values empty

#### Scenario: Repeated load does not duplicate issues

- **WHEN** the same problem for the same file, row and problem type is recorded twice
- **THEN** exactly one record of it exists

#### Scenario: Same row with different problems

- **WHEN** two different problem types are recorded for the same file and row
- **THEN** both are stored
