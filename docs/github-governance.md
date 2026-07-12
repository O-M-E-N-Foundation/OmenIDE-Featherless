# Omen IDE GitHub governance

This repository (`O-M-E-N-Foundation/OmenIDE-Featherless`) uses branch protection, CodeRabbit, security CI, and a Featherless-powered agent loop on GitHub Actions.

## Rules for `main`

- **No direct commits** to `main`. All changes go through pull requests.
- Apply the ruleset with [`scripts/setup-github-ruleset.ps1`](../scripts/setup-github-ruleset.ps1) (org admin + `gh auth login`).
- Required before merge:
  - Status checks: `CodeQL`, `secret-scan`, `pr-hygiene`, **`omen-typecheck`** (client TypeScript)
  - **1 approving review** (CodeRabbit APPROVE when review is clean; humans can approve too)
  - **All review threads resolved**
- For **`ai-authored` PRs**, auto-merge additionally requires a successful `omen-review-clean` check (agent verified CodeRabbit APPROVED + no open CodeRabbit threads + typecheck not failing). That check is **not** a branch ruleset requirement so human PRs are not blocked by it.

## Labels

| Label | Meaning |
|-------|---------|
| `ready-for-ai` | Write collaborator approved implement -> CodeRabbit -> **auto-merge** |
| `ai-in-flight` | Agent currently working this issue |
| `in-review` | PR open for this issue; CodeRabbit / address-review / CI until merge |
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
  -> implement (branch + PR labeled ai-authored; issue labeled in-review)
  -> CodeRabbit review (REQUEST_CHANGES while findings remain)
  -> `omen-typecheck` (client TS) — failures re-trigger address-review
  -> Featherless address-review (fix CodeRabbit + compile errors; debounce concurrent comments)
  -> CodeRabbit re-review **APPROVE**
  -> omen-review-clean + security CI + omen-typecheck green
  -> auto squash-merge to `main`
```

QA is **post-merge** (QA team and/or community). Regressions become new GitHub issues.

Review-fix rounds are capped (`OMEN_MAX_REVIEW_ROUNDS`, default `3`). Exhausted PRs get `needs-human` with actionable unblock steps and are not merged.

## CI on this fork

Full microsoft/vscode OSS PR CI (**Code OSS** Electron/Browser/Remote, node_modules compile, component screenshots, chat-lib PR jobs, Copilot setup runners) is **disabled** here. Those jobs need Microsoft 1ES self-hosted runners or Azure screenshot infra that this org does not host.

**Active merge / quality gates:**

- `CodeQL`
- `secret-scan` (Gitleaks; requires `GITLEAKS_LICENSE` secret)
- `pr-hygiene`
- **`omen-typecheck`** — `npm run typecheck-client`; required to merge; failing runs re-trigger address-review for `ai-authored` PRs
- CodeRabbit + `omen-address-review` → CodeRabbit **APPROVE** + resolved threads → `omen-review-clean`
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

[`.coderabbit.yaml`](../.coderabbit.yaml) enables auto-review on PRs with `request_changes_workflow: true` so CodeRabbit **requests changes** while actionable findings remain and **approves** when clear. Keep the CodeRabbit GitHub App installed on this repository.

Address-review:
- Debounces ~90s so a burst of inline comments becomes one agent run
- Checks out the **PR head branch** for edits, but always runs the **omen-agent harness from `main`** (PR branches lag)
- Treats unresolved review threads as the source of truth (agent `clean=true` is ignored if threads remain)
- **Fails the job** (not a green no-op) if the agent explores without `write_file`/`edit_file`, pushes no commits, or leaves CodeRabbit threads open — so schedule/monitors retry
- Posts `omen-review-clean` with the Actions `GITHUB_TOKEN` (`checks:write`)
- Auto-merge refuses to ship without CodeRabbit **APPROVED** and zero unresolved CodeRabbit threads

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
| `omen-address-review.yml` | Fix CodeRabbit feedback + typecheck failures; emit `omen-review-clean` |
| `omen-typecheck.yml` | Client TypeScript gate (`omen-typecheck`) |
| `omen-auto-merge.yml` | Squash-merge when gates pass |
| `codeql.yml` / `secret-scan.yml` / `pr-hygiene.yml` | Security gates |
