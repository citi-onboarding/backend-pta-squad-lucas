## Purpose

Defines how monthly point-in-time customer churn features and 90-day forward churn outcomes are computed across historical and ERP-synchronized records and stored without duplication or future data leakage.

## ADDED Requirements

### Requirement: Monthly customer feature panel and uniqueness

The system SHALL generate one churn feature record for each customer and calendar month from `2025-01` through the dataset cutoff month, uniquely identified by `(customer code, month)`, storing all monetary amounts in integer cents and keeping customer segment attached to every row.

#### Scenario: Full monthly timeline is generated per customer

- **WHEN** the churn feature computation runs for customers with master records and historical or ERP transactions up to a cutoff month
- **THEN** exactly one record exists for every `(customer code, month)` pair from `2025-01` through the cutoff month, carrying the customer's segment

#### Scenario: Repeated computation updates in place without duplicates

- **WHEN** the churn feature computation runs twice sequentially against the same target store with identical input data
- **THEN** the total number of stored `(customer code, month)` records and their field values remain identical after the second run

#### Scenario: Duplicate customer and month key is rejected at storage level

- **WHEN** a second churn feature record is inserted directly with an already stored `(customer code, month)` pair
- **THEN** the duplicate insert is rejected

### Requirement: Point-in-time feature calculation without future data leakage

For any row at calendar month `M`, the system SHALL compute `ordersLast3m`, `revenueLast3mCents`, `revenuePrev3mCents`, `daysSinceLastOrder`, and `overdueReceivables` using exclusively events occurring on or before the last calendar day of month `M`.

#### Scenario: Rolling three-month and prior three-month order metrics match exact window sums

- **WHEN** a customer has invoiced orders across known dates on or before month `M`
- **THEN** `ordersLast3m` equals the count of distinct invoiced orders in months `M-2` through `M`, `revenueLast3mCents` equals the sum of invoiced amounts in cents in months `M-2` through `M`, and `revenuePrev3mCents` equals the sum of invoiced amounts in cents in months `M-5` through `M-3`

#### Scenario: Future orders or future receivable payments do not alter past month features

- **WHEN** new orders or receivable payments occur strictly after the last calendar day of month `M`
- **THEN** `ordersLast3m`, `revenueLast3mCents`, `revenuePrev3mCents`, `daysSinceLastOrder`, and `overdueReceivables` for month `M` remain identical to values computed before those future events existed

#### Scenario: Point-in-time overdue receivables reconstructs unpaid past-due titles at month-end

- **WHEN** a customer has a non-reversed receivable whose due date is strictly before or on the last day of month `M` and whose payment date is either empty or strictly after the last day of month `M`
- **THEN** that receivable is counted in `overdueReceivables` for month `M`, and stops being counted in later months on or after its payment date

#### Scenario: Months prior to a customer's first invoiced order keep recency empty

- **WHEN** a customer has placed zero invoiced orders on or before the last calendar day of month `M`
- **THEN** `ordersLast3m` is `0`, `revenueLast3mCents` is `0`, `revenuePrev3mCents` is `0`, and `daysSinceLastOrder` is empty (`null`)

### Requirement: Historical and ERP source unification without double counting

The system SHALL combine pre-October 2026 historical invoiced orders and receivables with October 2026+ ERP-synchronized orders and receivables, excluding cancelled orders and reversed receivables and deduplicating overlapping receivables by title number with ERP precedence.

#### Scenario: Cancelled orders and reversed receivables are excluded

- **WHEN** historical records include cancelled order items (`CANCELLED`) or reversed receivables (`REVERSED`), or portal orders that were not invoiced/approved into the ERP
- **THEN** none of those excluded records increment `ordersLast3m`, `revenueLast3mCents`, `revenuePrev3mCents`, `daysSinceLastOrder`, or `overdueReceivables`

#### Scenario: Overlapping October 2026 receivable in both sources is counted once using ERP state

- **WHEN** the same receivable title number exists in both historical receivables and ERP receivables
- **THEN** the receivable is evaluated once using the ERP record's dates, amount, and status

### Requirement: Ninety-day forward churn outcome labeling

For each `(customer code, month)` row, the system SHALL compute `churned90d` as a nullable boolean representing whether an already-active buyer reaches 90 or more consecutive days without an invoiced order during the 90 calendar days following month-end, leaving `churned90d` empty (`null`) whenever the label cannot be validly determined.

#### Scenario: Buyer reaches ninety consecutive days without an invoiced order within the forward window

- **WHEN** a customer has at least one invoiced order on or before month-end, at least 90 calendar days exist between month-end and the dataset cutoff date, and at some day within `(month_end, month_end + 90 days]` the elapsed days since their latest invoiced order reaches 90 or more
- **THEN** `churned90d` for that row is `true`

#### Scenario: Buyer keeps purchasing with gaps strictly below ninety days across the forward window

- **WHEN** a customer has at least one invoiced order on or before month-end, at least 90 calendar days exist between month-end and the dataset cutoff date, and on every day within `(month_end, month_end + 90 days]` the elapsed days since their latest invoiced order stays below 90
- **THEN** `churned90d` for that row is `false`

#### Scenario: Months before the first invoiced order have an empty churn label

- **WHEN** a customer has zero invoiced orders on or before the last calendar day of month `M`
- **THEN** `churned90d` for month `M` is empty (`null`)

#### Scenario: Recent months without a full ninety-day forward horizon have an empty churn label

- **WHEN** fewer than 90 calendar days exist between the last calendar day of month `M` and the dataset cutoff date
- **THEN** `churned90d` for month `M` is empty (`null`)
