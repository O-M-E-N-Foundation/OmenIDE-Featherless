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
| `ready-for-ai` | Write collaborator approved implement -> CodeRabbit -> **auto-merge** |
| `ai-in-flight` | Agent currently working this issue |
| `ai-authored` | PR produced by the Omen agent |
| `needs-human` | Blocked only when the agent posts **actionable questions + unblock steps** |
| `triage:needs-info` | Incomplete issue |
| `triage:duplicate` | Likely duplicate |
| `security` | Never auto-implement or auto-merge |

### `needs-human` contract

When the agent applies `needs-human`, the comment **must** include:

1. **Blocker** - what is missing or broken (concrete)
2. **Please answer** - numbered questions with recommended defaults
3. **To unblock** - exact steps (usually: comment answers -> remove `needs-human` -> add `ready-for-ai`)

If the agent escalates without that structure, the runner **rejects** the escalation (does not apply `needs-human`) so the issue can be re-queued.

`ready-for-ai` already means ship approval: agents must choose sensible defaults for minor design details instead of asking humans to redesign the approach.

Create labels once:

```powershell
./scripts/setup-github-labels.ps1
```

### Who may apply `ready-for-ai`

Only users with **Write**, **Maintain**, or **Admin** on the repo. The `ready-for-ai-gate` workflow removes the label if anyone else applies it.

**`ready-for-ai` means approve to implement and ship**, not "open a draft for humans." Only add it when acceptance criteria are clear enough to merge.

Issues labeled `security` never enter the autonomous path.

## Agent pipeline

```
Issue opened -> Featherless triage (comment + triage labels)
Write collaborator adds ready-for-ai
  -> implement (branch + PR labeled ai-authored)
  -> CodeRabbit review
  -> Featherless address-review (fix loop)
  -> omen-review-clean + security CI green
  -> auto squash-merge to main
```

QA is **post-merge** (QA team and/or community). Regressions become new GitHub issues.

Review-fix rounds are capped (`OMEN_MAX_REVIEW_ROUNDS`, default `3`). Exhausted PRs get `needs-human` with actionable unblock steps and are not merged.

## CI on this fork

Full microsoft/vscode OSS PR CI (**Code OSS** Electron/Browser/Remote, node_modules compile, component screenshots, chat-lib PR jobs, Copilot setup runners) is **disabled** here. Those jobs need Microsoft 1ES self-hosted runners or Azure screenshot infra that this org does not host.

**Active merge / quality gates:**

- `CodeQL`
- `secret-scan` (Gitleaks; requires `GITLEAKS_LICENSE` secret)
- `pr-hygiene`
- CodeRabbit + `omen-address-review` → `omen-review-clean`
- Monaco Editor checks / telemetry metadata (lightweight, GitHub-hosted)

Disabled suites remain in `.github/workflows/` as `workflow_dispatch`-only so they can be re-enabled later if runners are available.

## Secrets and variables

Configure under **Settings -> Secrets and variables -> Actions**:

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
