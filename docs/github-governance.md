# Omen IDE GitHub governance

This repository (`O-M-E-N-Foundation/OmenIDE-Featherless`) uses branch protection, CodeRabbit, security CI, and a Featherless-powered agent loop on GitHub Actions.

## Rules for `main`

- **No direct commits** to `main`. All changes go through pull requests.
- Apply the ruleset with [`scripts/setup-github-ruleset.ps1`](../scripts/setup-github-ruleset.ps1) (org admin + `gh auth login`).
- Required status checks before merge:
  - `CodeQL`
  - `secret-scan`
  - `pr-hygiene`
- For **`ai-authored` PRs**, auto-merge also requires a successful `omen-review-clean` check (CodeRabbit feedback cleared). That check is **not** a branch ruleset requirement so human PRs are not blocked.

## Labels

| Label | Meaning |
|-------|---------|
| `ready-for-ai` | Write collaborator approved implement â†’ CodeRabbit â†’ **auto-merge** |
| `ai-in-flight` | Agent currently working the issue |
| `ai-authored` | PR produced by the Omen agent |
| `needs-human` | Blocked (spec, credentials, security, exhausted fix rounds) |
| `triage:needs-info` | Incomplete issue |
| `triage:duplicate` | Likely duplicate |
| `security` | Never auto-implement or auto-merge |

Create labels once:

```powershell
./scripts/setup-github-labels.ps1
```

### Who may apply `ready-for-ai`

Only users with **Write**, **Maintain**, or **Admin** on the repo. The `ready-for-ai-gate` workflow removes the label if anyone else applies it.

**`ready-for-ai` means approve to implement and ship**, not â€œopen a draft for humans.â€ Only add it when acceptance criteria are clear enough to merge.

Issues labeled `security` never enter the autonomous path.

## Agent pipeline

```
Issue opened â†’ Featherless triage (comment + triage labels)
Write collaborator adds ready-for-ai
  â†’ implement (branch + PR labeled ai-authored)
  â†’ CodeRabbit review
  â†’ Featherless address-review (fix loop)
  â†’ omen-review-clean + security CI green
  â†’ auto squash-merge to main
```

QA is **post-merge** (QA team and/or community). Regressions become new GitHub issues.

Review-fix rounds are capped (`OMEN_MAX_REVIEW_ROUNDS`, default `3`). Exhausted PRs get `needs-human` and are not merged.

## Secrets and variables

Configure under **Settings â†’ Secrets and variables â†’ Actions**:

| Name | Type | Purpose |
|------|------|---------|
| `FEATHERLESS_API_KEY` | Secret | Featherless OpenAI-compatible API key |
| `OMEN_AGENT_GITHUB_TOKEN` | Secret | PAT or GitHub App installation token with `contents`, `issues`, `pull_requests`, `checks`, `statuses` |
| `OMEN_AGENT_MODEL` | Variable (optional) | Model id (default `zai-org/GLM-5.2`) |
| `OMEN_MAX_REVIEW_ROUNDS` | Variable (optional) | Max CodeRabbit fix rounds (default `3`) |

Prefer a **GitHub App** installation token over a personal PAT so merges and check runs use a bot identity. Grant the App permission to push to protected branches / bypass only as needed for squash-merge under the ruleset.

`GITHUB_TOKEN` alone is not enough for all merge/check scenarios under a strict ruleset; use `OMEN_AGENT_GITHUB_TOKEN` in agent workflows.

## CodeRabbit

[`.coderabbit.yaml`](../.coderabbit.yaml) enables auto-review on PRs. Keep the CodeRabbit GitHub App installed on this repository.

## Security

- CodeQL (JavaScript/TypeScript) on PRs and weekly
- Gitleaks secret scan on PR diffs
- Dependabot for npm, GitHub Actions, and devcontainers
- PR hygiene job blocks obvious secret path additions and key literals

Report vulnerabilities privately per [SECURITY.md](../SECURITY.md). Do not file public issues for active exploits.

## Related workflows

| Workflow | Role |
|----------|------|
| `ready-for-ai-gate.yml` | Enforce Write-only `ready-for-ai` |
| `omen-triage.yml` | Featherless issue triage |
| `omen-implement.yml` | Implement ready issues |
| `omen-address-review.yml` | Fix CodeRabbit feedback; emit `omen-review-clean` |
| `omen-auto-merge.yml` | Squash-merge when gates pass |
| `codeql.yml` / `secret-scan.yml` / `pr-hygiene.yml` | Security gates |

