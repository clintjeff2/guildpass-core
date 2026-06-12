# GuildPass Core Tasks

This document lists tasks suitable for open contributions. Each task is scoped, actionable, and ready for contributors to pick up.

Maintainers: ensure each task has a corresponding GitHub issue with appropriate labels.

---

## 🟢 Ready to Contribute

### TASK-CORE-001: Add integration tests for the `/v1/access/check` endpoint
- **Difficulty**: Medium
- **Labels**: `good first issue`, `api`, `tests`
- **Description**: The access check endpoint has no integration tests. Add tests using a test database (or in-memory fixtures) covering allowed/denied cases for each policy type.
- **Files to change**: `apps/access-api/tests/` (new or extend)
- **Acceptance criteria**:
  - Tests for `PUBLIC`, `MEMBERS_ONLY`, `ADMINS_ONLY`, `CONTRIBUTORS_OR_ADMINS` policies
  - Tests cover both allowed and denied responses
  - `npm run test` passes
- **Tests**: `npm run test` — all green
- **Reviewer expectations**: No real database required; mocked or seeded test DB acceptable

---

### TASK-CORE-002: Add OpenAPI response schemas to all endpoints
- **Difficulty**: Easy–Medium
- **Labels**: `good first issue`, `api`, `documentation`
- **Description**: Several Fastify route handlers are missing explicit `response` schemas in their route config, causing the OpenAPI docs to show incomplete types. Add them.
- **Files to change**: `apps/access-api/src/routes/`
- **Acceptance criteria**:
  - All MVP endpoints have response schemas defined
  - OpenAPI docs at `/docs` show complete response types
  - `npm run typecheck` passes
- **Tests**: Manual check of `/docs` and `npm run typecheck`
- **Reviewer expectations**: Use shared types from `packages/shared-types` where possible

---

### TASK-CORE-003: Write Foundry fuzz tests for MembershipNFT expiry logic
- **Difficulty**: Medium
- **Labels**: `help wanted`, `smart contract`, `tests`
- **Description**: The MembershipNFT has expiry semantics but only basic tests. Add Foundry fuzz tests (`vm.assume`) to verify expiry edge cases.
- **Files to change**: `contracts/test/`
- **Acceptance criteria**:
  - Fuzz tests for `isExpired()` with arbitrary timestamps
  - Fuzz tests for `renew()` with boundary expiry values
  - `forge test` passes with no failures
- **Tests**: `npm run contracts:test`
- **Reviewer expectations**: NatSpec on new test functions; no state mutation between fuzz runs

---

### TASK-CORE-004: Add a `GET /v1/health` endpoint
- **Difficulty**: Easy
- **Labels**: `good first issue`, `api`
- **Description**: Add a health-check endpoint that returns `{ status: "ok", timestamp: <ISO string>, db: "connected" | "error" }`. Should test DB connectivity.
- **Files to change**: `apps/access-api/src/routes/health.ts` (new), register in server
- **Acceptance criteria**:
  - Returns 200 with correct body when DB is up
  - Returns 503 when DB is unreachable
  - Documented in OpenAPI
- **Tests**: At least one test verifying the 200 response
- **Reviewer expectations**: Must not expose secrets or internal error details

---

### TASK-CORE-005: Add a CI workflow for tests and type-checking
- **Difficulty**: Easy
- **Labels**: `good first issue`, `tests`
- **Description**: Add a GitHub Actions workflow that runs on every push and PR: installs deps, runs `npm run typecheck` and `npm run test`.
- **Files to change**: `.github/workflows/ci.yml` (new)
- **Acceptance criteria**:
  - Triggers on `push` and `pull_request` to `main`
  - Node 18, `npm ci`, typecheck, test steps
  - Postgres service container or mocked DB for tests
- **Tests**: Workflow passes on a draft PR
- **Reviewer expectations**: Clean YAML; separate jobs for typecheck and test are acceptable

---

## 🟡 Planned (not yet open)

- Implement `GET /v1/communities/:communityId/roles` endpoint
- Add pagination to `GET /v1/communities/:communityId/members`
- Implement rate limiting on the access check endpoint
- Add Prisma seed script for automated CI
- Add `forge coverage` reporting to CI

---

*To work on a task, comment on the linked GitHub issue.*
