## Purpose

Defines how much credit a customer still has available, so that later features can decide
whether an order fits the customer's credit limit (RN-01).

## ADDED Requirements

### Requirement: Available credit

The available credit of a customer, in cents, MUST be the customer's credit limit in
cents minus the sum of the amounts, in cents, of the customer's receivables whose status
is `OPEN` or `OVERDUE`. Receivables with status `PAID` MUST NOT count. The result MUST
NOT be rounded or limited to zero: it is negative when the unpaid receivables exceed the
limit. The calculation MUST work on integer cents only (RN-13); a credit limit or an
amount that is not a safe integer MUST be rejected with an error instead of producing a
number.

#### Scenario: Open receivables reduce the limit

- **WHEN** the credit limit is 1000000 cents and the receivables are one `OPEN` of 300000 cents
- **THEN** the available credit is 700000 cents

#### Scenario: Overdue receivables reduce the limit

- **WHEN** the credit limit is 1000000 cents and the receivables are one `OVERDUE` of 250000 cents
- **THEN** the available credit is 750000 cents

#### Scenario: Paid receivables do not count

- **WHEN** the credit limit is 1000000 cents and the receivables are one `OPEN` of 300000 cents and one `PAID` of 500000 cents
- **THEN** the available credit is 700000 cents

#### Scenario: No receivables

- **WHEN** the credit limit is 1000000 cents and there are no receivables
- **THEN** the available credit is 1000000 cents

#### Scenario: Unpaid receivables exceed the limit

- **WHEN** the credit limit is 100000 cents and the unpaid receivables add up to 130000 cents
- **THEN** the available credit is -30000 cents

#### Scenario: Several unpaid receivables add up

- **WHEN** the credit limit is 1000000 cents with one `OPEN` of 100000 cents and two `OVERDUE` of 200000 cents each
- **THEN** the available credit is 500000 cents

#### Scenario: A value that is not whole cents

- **WHEN** the credit limit or a receivable amount is not an integer number of cents
- **THEN** the calculation fails with an error and returns no number

### Requirement: Known limits of the calculation

The calculation MUST use only the receivables it is given and MUST NOT read the customer's
status. It MUST NOT count historical receivables loaded from files. Receivables issued
before 2026-10-01 are not available from the ERP, so the result can overstate the
available credit of a customer with an older unpaid receivable. A blocked customer MUST
get the same arithmetic as any other customer; deciding what blocking means for an order
is outside this capability. These limits MUST be repeated in the pull request.

#### Scenario: Only the given receivables count

- **WHEN** the credit limit is 1000000 cents and the only receivable given is one `OPEN` of 300000 cents
- **THEN** the available credit is 700000 cents, whatever else exists elsewhere for that customer

#### Scenario: The customer status does not change the arithmetic

- **WHEN** the same limit and receivables are used for a blocked customer and for an active customer
- **THEN** both get the same available credit
