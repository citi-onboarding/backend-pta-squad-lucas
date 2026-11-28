## Purpose

Tells the commercial team whether a supply contract needs attention by deriving its notice deadline and its status from the contract's resolved end date, its notice period, and a reference date.

## ADDED Requirements

### Requirement: Notice deadline

The system SHALL compute a contract's notice deadline as its resolved end date minus its notice period, counted in calendar days (RN-11). The end date it receives is already resolved, including any amendment; the system MUST NOT select amendments, recalculate automatic renewals, or skip non-business days.

#### Scenario: Subtraction crosses a month and a year boundary

- **GIVEN** a contract ending on 2027-01-10 with a 30-day notice period
- **WHEN** its status is evaluated on 2026-11-15
- **THEN** the status is `NOTIFY_BY` with notice deadline 2026-12-11

### Requirement: Contract status

The system SHALL assign exactly one status to a contract, comparing calendar days between the reference date, the notice deadline, and the end date, and evaluating the statuses in this priority order:

1. `EXPIRED` ("Vencido") when the reference date is after the end date.
2. `NOTICE_OVERDUE` ("Prazo de aviso vencido") when the reference date is after the notice deadline and on or before the end date.
3. `NOTIFY_BY` ("Avisar até [data]") when the notice deadline is 0 to 30 calendar days, inclusive, after the reference date; the result MUST include the notice deadline.
4. `ON_TRACK` ("Em dia") when the notice deadline is more than 30 calendar days after the reference date.

The reference date MUST be supplied by the caller; the system MUST NOT read the current clock. Only the calendar day of each date SHALL matter; the time of day MUST NOT change the result.

Scenarios below use a contract ending on 2026-12-31 with a 30-day notice period, so its notice deadline is 2026-12-01, unless they state otherwise.

#### Scenario: Well ahead of the notice deadline

- **WHEN** the status is evaluated on 2026-06-15
- **THEN** the status is `ON_TRACK`

#### Scenario: Exactly 31 days before the notice deadline

- **WHEN** the status is evaluated on 2026-10-31
- **THEN** the status is `ON_TRACK`

#### Scenario: Exactly 30 days before the notice deadline

- **WHEN** the status is evaluated on 2026-11-01
- **THEN** the status is `NOTIFY_BY` with notice deadline 2026-12-01

#### Scenario: On the notice deadline

- **WHEN** the status is evaluated on 2026-12-01
- **THEN** the status is `NOTIFY_BY` with notice deadline 2026-12-01

#### Scenario: The day after the notice deadline

- **WHEN** the status is evaluated on 2026-12-02
- **THEN** the status is `NOTICE_OVERDUE`

#### Scenario: On the last day of the contract term

- **WHEN** the status is evaluated on 2026-12-31
- **THEN** the status is `NOTICE_OVERDUE`

#### Scenario: The day after the contract term ends

- **WHEN** the status is evaluated on 2027-01-01
- **THEN** the status is `EXPIRED`

#### Scenario: Expired takes precedence over an overdue notice

- **WHEN** the status is evaluated on 2027-02-15, after both the notice deadline and the end date
- **THEN** the status is `EXPIRED`

#### Scenario: Time of day is ignored

- **WHEN** the status is evaluated at 23:00 on 2026-10-31, which is 31 calendar days but less than 31 full 24-hour periods before the notice deadline
- **THEN** the status is `ON_TRACK`

#### Scenario: Inputs are not modified

- **WHEN** the status is evaluated for any end date and reference date
- **THEN** both dates keep the exact instant they had before the evaluation
- **AND** a returned notice deadline is a separate date from the end date received
