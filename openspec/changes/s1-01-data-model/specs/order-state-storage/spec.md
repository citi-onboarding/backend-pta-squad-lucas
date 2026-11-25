## Purpose

Defines how orders and their items are stored, including the closed list of order states, so that the order flow of the next sprint can rely on a stable structure.

## ADDED Requirements

### Requirement: Closed order states

The system SHALL accept only these order states: `DRAFT`, `SENDING`, `SENT_TO_ERP`, `SEND_ERROR`, `CREDIT_BLOCKED`, `AWAITING_FINANCE`, `APPROVED` and `REJECTED`.

#### Scenario: Each defined state is accepted

- **WHEN** an order is saved with any one of the 8 states
- **THEN** the order is stored with that state

#### Scenario: Unknown state is rejected

- **WHEN** an order is saved with a state outside the list
- **THEN** the save is rejected

### Requirement: Order totals and items in cents

The system SHALL store the order total, each item's unit price and each item's subtotal as whole numbers of cents, and SHALL tie every item to an existing order and an existing product.

#### Scenario: Order with items

- **WHEN** an order is saved with two items
- **THEN** reading the order returns both items with their quantities and cent values

#### Scenario: Item of a missing product is rejected

- **WHEN** an order item is saved for a product that does not exist
- **THEN** the save is rejected

### Requirement: Unique send key

The system SHALL keep each order send key unique, so that the same order cannot be registered twice for sending.

#### Scenario: Duplicate send key is rejected

- **WHEN** an order is saved with a send key that another order already has
- **THEN** the save is rejected

### Requirement: Order ownership

The system SHALL tie every order to an existing customer and an existing seller.

#### Scenario: Order for a missing customer is rejected

- **WHEN** an order is saved for a customer that does not exist
- **THEN** the save is rejected
