## ADDED Requirements

### Requirement: Historical field standardization

The ingestion process SHALL normalize dates, monetary amounts, ERP codes, tax identifiers, cities and states, seller names, quantities, installments, and statuses from the three historical spreadsheets into canonical formats, storing every monetary amount as an integer number of cents.

#### Scenario: Mixed monetary formats are converted to integer cents

- **WHEN** a historical row contains a monetary value formatted with currency symbols (`R$ 1.234,56`), Brazilian thousands (`20.000`), thousand abbreviations (`187 mil`), US decimals (`9346.14`), numeric types, or negative reversal amounts (`-5542,18`)
- **THEN** the value is converted to the exact integer amount in cents without floating-point drift

#### Scenario: Mixed date formats and Excel serial numbers are standardized

- **WHEN** a historical row contains a date as a calendar object, ISO string (`YYYY-MM-DD`), slash/dash/dot Brazilian date (`DD/MM/YYYY`, `DD/MM/YY`, `DD-MM-YYYY`, `DD.MM.YYYY`), or an Excel serial number (`45661`)
- **THEN** the date is normalized to a canonical calendar date

#### Scenario: Seller nicknames and short ERP codes are standardized

- **WHEN** a historical row uses a commercial nickname for one of the five DistriLux sellers or omits leading zeros or uppercase casing in a customer or product code (`c0040`, `C077`)
- **THEN** the seller is mapped to the official seller name and the code is normalized to its canonical uppercase zero-padded ERP identifier (`C0040`, `C0077`)

#### Scenario: Missing order item total is derived from cleaned quantity and unit price

- **WHEN** an order item row has an empty calculated total cell, a valid positive quantity (including unit suffixes such as `21 un` or `90,0`), and a valid unit price
- **THEN** the order item total is computed in integer cents as quantity multiplied by unit price in cents

### Requirement: Single-match ERP catalog association

The ingestion process SHALL associate a free-text customer name or a missing product code (using its description) to an official ERP record only when there is exactly one normalized match in the ERP catalog, and MUST record a load issue when zero or multiple matches exist.

#### Scenario: Free-text customer name matches a single ERP customer

- **WHEN** an order item provides a customer name instead of a customer code and exactly one ERP customer shares the normalized name
- **THEN** the order item is linked to that customer's ERP code and the correction is recorded

#### Scenario: Missing product code matches a single ERP product description

- **WHEN** an order item omits the product code and its normalized description (including unit spacing variations such as `35 mm2` and `35mm²`) matches exactly one ERP product
- **THEN** the order item is linked to that product's ERP code and the correction is recorded

#### Scenario: Lookup yields zero or multiple ERP matches

- **WHEN** a customer name or product description matches zero ERP records or more than one ERP record
- **THEN** the row is excluded from the loaded historical records and recorded as a pending load issue with the specific reason (`no_match` or `ambiguous_match`)

### Requirement: ERP precedence on divergences

When historical spreadsheet customer data disagrees with synchronized ERP data, the ERP record SHALL take precedence and the ingestion process MUST NOT overwrite ERP-owned records.

#### Scenario: Spreadsheet customer limit or status disagrees with ERP

- **WHEN** the commercial customers spreadsheet lists a different credit limit, status, or seller than the ERP customer record for the same customer code
- **THEN** the ERP values are preserved unchanged and the divergence is noted without modifying the ERP customer record

#### Scenario: Prospect customer does not exist in ERP

- **WHEN** a row in the commercial customers spreadsheet has no ERP code or matching tax identifier in the ERP
- **THEN** the row is recorded as a pending load issue with an explicit reason instead of creating an ERP customer

### Requirement: Deduplication and receivable reconciliation

The ingestion process SHALL deduplicate repeated rows after normalization so each historical order item appears once per `(order number, product code)` and each historical receivable appears once per title number, while reconciling reversal pairs and flagging conflicting duplicates.

#### Scenario: Repeated order item written with different formats is loaded once

- **WHEN** two rows in the orders spreadsheet refer to the same `(order number, product code)` and become identical after date, casing, quantity, and status normalization
- **THEN** a single order item is loaded and the extra copy is counted as discarded

#### Scenario: Paid receivable paired with an equal-magnitude reversal entry is reconciled

- **WHEN** the receivables file contains a positive title entry and a matching negative reversal entry with the same title number and equal absolute amount
- **THEN** a single receivable record is loaded with status `REVERSED`, empty payment date, positive magnitude in cents, and a recorded reconciliation note, while the offsetting row is counted as discarded

#### Scenario: Receivable with payment date and stale open or overdue status is reconciled

- **WHEN** a receivable row is labeled as open or overdue but already has a valid payment date
- **THEN** the loaded receivable status is normalized to `PAID` and the correction is recorded

#### Scenario: Duplicate title number has conflicting monetary amounts

- **WHEN** multiple rows share the same title number with incompatible monetary amounts that do not form a reversal pair
- **THEN** none of the conflicting rows are guessed or overwritten into loaded receivables, and each conflicting row is recorded as a pending load issue with reason `conflicting_duplicate_title`

### Requirement: Cancelled order isolation

The ingestion process SHALL preserve cancelled historical order items with status `CANCELLED` and exclude them from net sales totals.

#### Scenario: Cancelled and invoiced items coexist in historical orders

- **WHEN** historical orders include both invoiced items and cancelled items (with any casing or trailing whitespace)
- **THEN** cancelled items are persisted with status `CANCELLED` and net sales calculations sum only `INVOICED` items

### Requirement: Idempotent execution and per-file accounting

Re-running the ingestion process with the same inputs SHALL produce the exact same persisted counts without duplicating historical records or load issues, and every run MUST balance `read = loaded + discarded + pending` for each source file.

#### Scenario: Noise and footer rows are discarded and accounted for

- **WHEN** a spreadsheet contains completely empty rows or a summary `TOTAL` footer row
- **THEN** those rows are discarded and included in the file's discarded count so `read = loaded + discarded + pending` holds

#### Scenario: Re-running the full ingestion does not duplicate records

- **WHEN** the historical ingestion runs twice sequentially against the same target store with the same three source files
- **THEN** the total number of persisted order items, receivables, and load issues remains identical after the second run

#### Scenario: Unresolvable mandatory field is sent to load issues

- **WHEN** a row is missing a mandatory unresolvable identifier (such as an empty customer identifier in the receivables file) or has an unparseable mandatory value
- **THEN** the row is recorded as a pending load issue with source file, row number, raw key, and explicit reason, and counted under `pending`
