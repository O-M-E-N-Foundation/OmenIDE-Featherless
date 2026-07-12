#Requires -Version 5.1
<#
.SYNOPSIS
  Create Omen AI / triage labels on the repository.
#>

param(
	[string]$Owner = "O-M-E-N-Foundation",
	[string]$Repo = "OmenIDE-Featherless"
)

$ErrorActionPreference = "Stop"

$labels = @(
	@{ name = "ready-for-ai"; color = "2ecc71"; description = "Approved to implement, review, and auto-merge" }
	@{ name = "ai-in-flight"; color = "3498db"; description = "Omen agent is currently working this issue" }
	@{ name = "in-review"; color = "8e44ad"; description = "AI PR open: CodeRabbit / address-review / CI until merge" }
	@{ name = "ai-authored"; color = "9b59b6"; description = "PR produced by the Omen Featherless agent" }
	@{ name = "needs-human"; color = "e74c3c"; description = "Blocked for a human (spec, security, exhausted AI loops)" }
	@{ name = "triage:needs-info"; color = "f39c12"; description = "Triage found incomplete acceptance criteria" }
	@{ name = "triage:duplicate"; color = "95a5a6"; description = "Likely duplicate of an existing issue" }
	@{ name = "security"; color = "c0392b"; description = "Security-sensitive; never auto-implement or auto-merge" }
)

foreach ($label in $labels) {
	Write-Host "Ensuring label $($label.name) ..."
	$exists = gh label list -R "$Owner/$Repo" --json name --jq ".[].name" 2>$null
	if ($exists -split "`n" | Where-Object { $_ -eq $label.name }) {
		gh label edit $label.name -R "$Owner/$Repo" --color $label.color --description $label.description
	} else {
		gh label create $label.name -R "$Owner/$Repo" --color $label.color --description $label.description
	}
}

Write-Host "Labels ready."

