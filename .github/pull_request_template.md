## What this change does

<!-- Describe the behavior this pull request adds or changes and why. Link the task. -->

## A risk I see

<!-- Name at least one risk: what could break, who is affected, and how to roll back. -->

## How I used AI

<!-- Required for level 3 and level 5 tasks. Otherwise write "Not applicable". -->

- What I asked:
- What I rejected:
- How I verified it:

## OpenSpec, TDD, and documentation

- OpenSpec change: <!-- link, or Not applicable with rationale -->
- Affected business capability:
- Acceptance scenarios mapped to tests:
- Red evidence: <!-- failing test command and result -->
- Green evidence: <!-- passing narrow test command and result -->
- Refactor evidence: <!-- tests rerun after refactoring -->
- Change summary: <!-- docs/changes/<change-id>.md, or Pending archive with rationale -->
- ADR: <!-- link, or Not applicable with rationale -->
- Archive status: <!-- active | archived -->

## Impact

- API/OpenAPI compatibility:
- Database migration and rollback:
- Security and privacy:
- Observability and operations:
- Documentation:

## Verification

- [ ] `pnpm format:check`
- [ ] `pnpm verify`
- [ ] `pnpm test:coverage`
- [ ] `pnpm test:integration`, when database behavior changes
- [ ] `pnpm test:container`, when delivery behavior changes

## Checklist

- [ ] OpenSpec artifacts were reviewed before implementation.
- [ ] Every applicable specification scenario has automated test coverage.
- [ ] Dependencies follow `app → modules → shared` and modules remain isolated.
- [ ] Inputs and serialized responses are validated with Zod.
- [ ] `openapi.json` matches the executable contract.
- [ ] Logs contain no bodies, credentials, tokens, cookies, or personal data.
- [ ] Migrations are additive and safe for deployed environments.
- [ ] Compatibility, rollout, and rollback are documented.
- [ ] The change summary follows `docs/templates/change.md`, when archiving.
- [ ] The ADR follows `docs/templates/adr.md`, when applicable.
- [ ] Archive prerequisites passed: applicable tests, typecheck, and strict OpenSpec validation.
