#Requires -Version 5.1
<#
.SYNOPSIS
  Create or update the Omen IDE ruleset that protects main.

.DESCRIPTION
  Requires: gh auth login with admin on O-M-E-N-Foundation/OmenIDE-Featherless

  Required checks: CodeQL, secret-scan, pr-hygiene
  Pull request rules: 1 approving review (CodeRabbit APPROVE when clean) + resolved threads
  omen-review-clean is enforced by omen-auto-merge for ai-authored PRs only (not a branch ruleset check, so human PRs are not blocked by that check alone).
#>

param(
	[string]$Owner = "O-M-E-N-Foundation",
	[string]$Repo = "OmenIDE-Featherless",
	[string]$RulesetName = "omen-protect-main"
)

$ErrorActionPreference = "Stop"

Write-Host "Ensuring ruleset '$RulesetName' on $Owner/$Repo ..."

$existingId = (gh api "repos/$Owner/$Repo/rulesets" --jq ".[] | select(.name==\`"$RulesetName\`") | .id" 2>$null)
$existingId = "$existingId".Trim()

$payload = @"
{
  "name": "$RulesetName",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "CodeQL" },
          { "context": "secret-scan" },
          { "context": "pr-hygiene" }
        ]
      }
    }
  ],
  "bypass_actors": [
    {
      "actor_id": 1,
      "actor_type": "OrganizationAdmin",
      "bypass_mode": "always"
    }
  ]
}
"@

$tmp = Join-Path $env:TEMP "omen-ruleset-$PID.json"
# UTF-8 without BOM (hygiene)
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($tmp, $payload, $utf8)

try {
	if ($existingId) {
		Write-Host "Updating ruleset id $existingId ..."
		gh api --method PUT "repos/$Owner/$Repo/rulesets/$existingId" --input $tmp
	} else {
		Write-Host "Creating ruleset ..."
		gh api --method POST "repos/$Owner/$Repo/rulesets" --input $tmp
	}
	Write-Host "Done. Organization admins can bypass when needed for bootstrap."
	Write-Host "See docs/github-governance.md"
} finally {
	Remove-Item $tmp -ErrorAction SilentlyContinue
}
