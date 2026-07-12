# Omen Featherless agent

GitHub Actions agent for triage / implement / CodeRabbit address-review / auto-merge.

See [docs/github-governance.md](../../docs/github-governance.md).

## Local dry-run

```bash
export FEATHERLESS_API_KEY=...
export OMEN_AGENT_GITHUB_TOKEN=...
export GITHUB_REPOSITORY=O-M-E-N-Foundation/vscode
export OMEN_ISSUE_NUMBER=1
node --experimental-strip-types src/index.ts triage
```

## Modes

| Mode | Env |
|------|-----|
| `triage` | `OMEN_ISSUE_NUMBER` |
| `implement` | `OMEN_ISSUE_NUMBER` |
| `address-review` | `OMEN_PR_NUMBER`, optional `OMEN_REVIEW_ROUND` |
| `merge-ready` | `OMEN_PR_NUMBER` |
| `auto-merge` | optional `OMEN_PR_NUMBER` (else all open `ai-authored` PRs) |
