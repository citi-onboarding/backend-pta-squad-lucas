## MODIFIED Requirements

### Requirement: Safe observability

The service SHALL emit structured request logs without request bodies and redact credentials, including the ERP API key header.

#### Scenario: Credentials are logged accidentally

- **WHEN** a structured log includes a password, token, authorization header, cookie, or ERP API key header
- **THEN** the value is replaced with `[REDACTED]`
