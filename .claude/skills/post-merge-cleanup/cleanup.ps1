# Post-merge cleanup driver -- mechanical half of the /post-merge-cleanup skill.
# Verifies the PR merged, deletes its remote branch, and polls production
# health until healthy or timeout. The judgment half (memory notes, hand-off)
# stays with the agent -- see SKILL.md.
#
# Usage: powershell -File .claude/skills/post-merge-cleanup/cleanup.ps1 -Pr 88
#        ... -HealthUrl none            (skip the health poll)
#        ... -HealthUrl https://x/health (override the default)
# Exit codes: 0 = merged + branch gone + prod healthy; 1 = any check failed.
#
# PowerShell 5.1 compatible: no ternary, no null-coalescing, no && chains.
# Keep this file PURE ASCII -- PS5.1 reads a BOM-less UTF-8 script as ANSI and
# a single em dash turns into a parse error.
param(
  [Parameter(Mandatory = $true)][int]$Pr,
  # Production health URL. 'none' skips the poll (no deploy to watch).
  [string]$HealthUrl = '{{PROD_HEALTH_URL}}',
  # Seconds to keep polling (a build + deploy can take a few minutes).
  [int]$HealthTimeoutSec = 600
)

$ErrorActionPreference = 'Stop'

# What "healthy" means. Extend this for your project's health endpoint: a bare
# 200 proves the process answers, not that it is doing its job. Hexreign, for
# example, also required its tick lag to be under 2 and read a heartbeat's
# staleness flag before trusting its duration figure.
function Test-Healthy($response) {
  if ($response.StatusCode -ne 200) { return $false }
  $body = $response.Content
  try {
    $json = $body | ConvertFrom-Json
  } catch {
    # Not JSON: a 200 is all we can check.
    return $true
  }
  if ($null -eq $json) { return $true }
  $hasOk = $json.PSObject.Properties.Name -contains 'ok'
  if ($hasOk) { return [bool]$json.ok }
  return $true
}

# 1. The PR must actually be merged -- never clean up an open branch.
$info = gh pr view $Pr --json state,mergedAt,mergeCommit,headRefName | ConvertFrom-Json
if ($info.state -ne 'MERGED') {
  Write-Host "PR #$Pr state is '$($info.state)', not MERGED -- stopping. Nothing was deleted."
  exit 1
}
Write-Host "PR #$Pr merged at $($info.mergedAt) as $($info.mergeCommit.oid.Substring(0,7))"

# 2. Delete the remote branch (idempotent: skip if GitHub already deleted it).
git fetch origin --prune
$branch = $info.headRefName
$exists = git ls-remote --heads origin $branch
if ($exists) {
  git push origin --delete $branch
  Write-Host "deleted origin/$branch"
} else {
  Write-Host "origin/$branch already deleted"
}

# 3. Poll production health until healthy.
if (($HealthUrl -eq 'none') -or ($HealthUrl -eq '')) {
  Write-Host 'no health URL configured: skipping the deploy watch.'
  Write-Host 'cleanup complete: PR merged, branch deleted.'
  exit 0
}

$deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 15
    Write-Host "health: $($response.StatusCode) $($response.Content)"
    if (Test-Healthy $response) { $healthy = $true; break }
  } catch {
    Write-Host "health probe failed: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 30
}

if (-not $healthy) {
  Write-Host "PROD NOT HEALTHY within $HealthTimeoutSec s -- alert the owner, see planning/RUNBOOK-release.md for rollback."
  exit 1
}
Write-Host 'cleanup complete: PR merged, branch deleted, prod healthy.'
exit 0
