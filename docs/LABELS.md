# GitHub Labels — GuildPass Core

This file documents the labels used on the `guildpass-core` repository for issue triage.

Create labels via **GitHub Settings → Labels** or with the GitHub CLI:

```bash
gh label create "good first issue" --color "7057ff" --description "Well-scoped task for new contributors"
gh label create "help wanted" --color "008672" --description "Extra attention or contributor help needed"
gh label create "bug" --color "d73a4a" --description "Something is not working"
gh label create "feature" --color "a2eeef" --description "New feature or enhancement request"
gh label create "documentation" --color "0075ca" --description "Improvements or additions to documentation"
gh label create "api" --color "c5def5" --description "Related to the Fastify access-api"
gh label create "smart contract" --color "8b5cf6" --description "Related to Solidity contracts (Foundry)"
gh label create "policy-engine" --color "f0e040" --description "Related to the access policy engine"
gh label create "database" --color "e4c5f9" --description "Related to Prisma schema or migrations"
gh label create "backend" --color "c2e0c6" --description "General backend / Node.js changes"
gh label create "tests" --color "bfd4f2" --description "Related to test coverage or test fixes"
gh label create "priority: low" --color "eeeeee" --description "Low priority"
gh label create "priority: medium" --color "fbca04" --description "Medium priority"
gh label create "priority: high" --color "e99695" --description "High priority — address promptly"
gh label create "security" --color "ee0701" --description "Security-related issue — handle with care"
gh label create "needs-triage" --color "ededed" --description "Awaiting maintainer triage"
gh label create "duplicate" --color "cfd3d7" --description "This issue or PR already exists"
gh label create "wont-fix" --color "ffffff" --description "This will not be worked on"
```

## Label Usage Guide

| Label | When to use |
|---|---|
| `good first issue` | Well-scoped, low-risk task with clear acceptance criteria |
| `help wanted` | Community help wanted — may need more context |
| `bug` | Confirmed broken behaviour |
| `feature` | New endpoint, policy rule, or contract capability |
| `documentation` | README, OpenAPI spec, or code comments |
| `api` | Changes to `apps/access-api` |
| `smart contract` | Changes to `contracts/` (Solidity / Foundry) |
| `policy-engine` | Changes to `packages/policy-engine` |
| `database` | Prisma schema or migration changes |
| `backend` | General Node.js / TypeScript backend changes |
| `tests` | Test-only additions or fixes |
| `security` | Security-sensitive issues — do not post reproduction details publicly |
| `priority: high` | Blocks users or production — address within 48 h |
