## Purpose

Defines how historical order items, historical receivables and data problems found in the old spreadsheets are stored, so that the historical load can run repeatedly without creating duplicates and without hiding problems.

## ADDED Requirements

### Requirement: Historical order items are loaded without duplicates

The system SHALL identify each historical order item by its content, with a counter only among rows whose content is identical, so that loading the same data again does not create new items, including items without a product code.

#### Scenario: Repeated load does not duplicate

- **WHEN** the same set of historical order items is loaded twice
- **THEN** the number of stored items is the same after the second load

#### Scenario: Item without product code is not duplicated

- **WHEN** an item without a product code is loaded twice
- **THEN** exactly one such item exists

#### Scenario: Identical rows are both kept

- **WHEN** two fully identical rows of the same order are loaded
- **THEN** both are stored as separate items

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

The system SHALL accept the historical receivable statuses `PAID`, `OPEN`, `OVERDUE` and `REVERSED`, SHALL allow the payment date to be empty, SHALL keep a record of the corrections applied, and SHALL keep both the original title and its reversal even though they share the same title id.

#### Scenario: Title and its reversal are both stored

- **WHEN** a title and its reversal with the same title id are stored
- **THEN** both exist, one with its original status and one with status `REVERSED`

#### Scenario: Same title is not duplicated

- **WHEN** the same title with the same status is loaded twice
- **THEN** exactly one such record exists

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
