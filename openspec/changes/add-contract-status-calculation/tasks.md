## 1. SDD

- [x] 1.1 Read US-021, RN-11, and the F21 task description; record scope and non-goals in `proposal.md`
- [x] 1.2 Write the `contract-status` delta spec with testable scenarios
- [x] 1.3 Record signature, calendar arithmetic, and test date convention in `design.md`
- [x] 1.4 Add the `date-fns` dependency prescribed by the task
- [x] 1.5 Run `openspec validate add-contract-status-calculation --strict`

## 2. Red

- [x] 2.1 Developer writes `src/modules/contracts/contract-status.test.ts` covering every scenario in `specs/contract-status/spec.md`, using local-time `Date` constructors and no clock reads
- [x] 2.2 Add a signature-only placeholder in `src/modules/contracts/contract-status.ts` so the tests compile and fail on behavior, not on imports
- [x] 2.3 Run `pnpm exec vitest run src/modules/contracts/contract-status.test.ts` and confirm every test fails because the behavior is not implemented
- [x] 2.4 Obtain explicit confirmation before Green

## 3. Green

- [x] 3.1 Implement the minimum `getContractStatus` that satisfies the spec
- [x] 3.2 Rerun the contract status tests and confirm they pass
- [x] 3.3 Obtain explicit confirmation before Refactor

## 4. Refactor

- [x] 4.1 Improve naming and readability without changing behavior
- [x] 4.2 Rerun the contract status tests and confirm they stay green

## 5. Consolidation

- [x] 5.1 Run `pnpm format:check`, `pnpm verify` (typecheck, lint, tests, architecture, `openspec validate --strict`, OpenAPI and skills checks), `pnpm test:coverage`, and `pnpm build`
- [x] 5.2 Write `docs/changes/add-contract-status-calculation.md` from `docs/templates/change.md`, stating that seed, endpoint, permissions, and web table remain pending
- [x] 5.3 Evaluate whether an ADR is needed
