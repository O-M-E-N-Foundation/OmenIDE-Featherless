# Contributing to Omen IDE

Thank you for contributing to **Omen IDE** ([O-M-E-N-Foundation/vscode](https://github.com/O-M-E-N-Foundation/vscode)).

This project is a fork of [microsoft/vscode](https://github.com/microsoft/vscode). Prefer filing Omen-specific issues and PRs here; upstream-worthy editor fixes can also be contributed to microsoft/vscode when appropriate.

## Ground rules

- **Do not push directly to `main`.** Open a pull request.
- Keep changes focused. Include a short description of *why* the change is needed.
- Do not commit secrets, API keys, or `.env` files.
- For governance, labels, and the Featherless agent pipeline, see [docs/github-governance.md](docs/github-governance.md).

## Issues

- Search existing issues before filing a duplicate.
- Use the bug or feature templates.
- Clear acceptance criteria help maintainers (and the AI agent) ship faster.

### Maintainer note: `ready-for-ai`

Only collaborators with **Write** (or higher) should apply `ready-for-ai`. That label means:

1. The issue is product-approved to implement **and merge**.
2. The Featherless agent will open a PR, address CodeRabbit feedback, and auto-merge when security checks pass.
3. QA happens **after** merge (QA team / community). Regressions → new issues.

Do **not** apply `ready-for-ai` to `security`-labeled issues or vague tickets missing acceptance criteria.

## Pull requests

- Target `main`.
- Prefer small, reviewable diffs.
- AI-authored PRs are labeled `ai-authored` and follow the automated review/merge path.

## Security

Report vulnerabilities privately per [SECURITY.md](SECURITY.md). Do not open public issues for active exploits.

## Questions

Product and contribution questions: open a GitHub Discussion or issue on this repository.
