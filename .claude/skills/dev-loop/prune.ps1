# Workspace prune -- phase 9 of the /dev-loop skill.
#
# Removes worktrees whose branch is already merged into origin/main AND whose
# working tree is clean AND which have been idle long enough. Then deletes the
# local branches that no worktree is using. Anything unmerged, dirty, locked,
# detached, recently active, or in use is REPORTED and left alone. Remote
# branches are only reported: other sessions may still be pushing to them.
#
# "Merged" means the branch tip is an ancestor of origin/main. That is exact
# for this repo because PRs land as merge commits (the convention recorded in
# /review-and-ship). A squash- or rebase-merged branch will NOT look merged
# here, so it gets kept and reported rather than wrongly deleted.
#
# Usage: powershell -File .claude/skills/dev-loop/prune.ps1
#        powershell -File .claude/skills/dev-loop/prune.ps1 -DryRun
# Exit codes: 0 = ran to completion (even if nothing was prunable); 1 = error.
#
# PowerShell 5.1 compatible: no ternary, no null-coalescing, no && chains.
# Keep this file PURE ASCII -- PS5.1 reads a BOM-less UTF-8 script as ANSI and
# a single em dash turns into a parse error.
param(
  # Show what would be removed without removing anything.
  [switch]$DryRun,
  # Leave worktrees alone until they have been idle this many hours. Guards
  # against yanking a worktree out from under another live session: a session
  # that is between edits looks exactly like an abandoned one (clean tree,
  # branch merged), and only recency separates them. 0 disables the guard.
  [int]$MinAgeHours = 12
)

$ErrorActionPreference = 'Continue'

function Norm($p) {
  if (-not $p) { return '' }
  return ($p -replace '\\', '/').TrimEnd('/').ToLower()
}

# Parse `git worktree list --porcelain` into records. Called more than once:
# the workspace changes while this script runs, and decisions must be made
# against the CURRENT state rather than a snapshot taken minutes earlier.
#
# The `locked` attribute matters and used to be dropped here. It is git's
# explicit "do not remove this worktree" marker, set by `git worktree lock`.
function Get-Worktrees {
  $list = @()
  $cur = $null
  foreach ($line in (git worktree list --porcelain)) {
    if ($line -like 'worktree *') {
      if ($cur) { $list += $cur }
      $cur = [pscustomobject]@{ Path = $line.Substring(9); Head = ''; Branch = ''; Locked = $false }
    } elseif ($line -like 'HEAD *') {
      $cur.Head = $line.Substring(5)
    } elseif ($line -like 'branch *') {
      $cur.Branch = $line.Substring(7) -replace '^refs/heads/', ''
    } elseif (($line -eq 'locked') -or ($line -like 'locked *')) {
      # Emitted bare, or with a reason: "locked" / "locked <reason>".
      $cur.Locked = $true
    }
  }
  if ($cur) { $list += $cur }
  # The leading comma stops PowerShell unrolling a single-element array.
  return ,$list
}

# Delete a branch ref only if it still points where we verified it. Plain
# `git branch -D` deletes by name, so a commit made between the merged check
# and the delete would be discarded without ever being checked -- and the
# window here spans a worktree removal that can take minutes. update-ref's
# compare-and-delete form fails instead, which is the outcome we want.
#
# One thing update-ref does NOT do that `git branch -d` does: refuse to delete
# a branch that is checked out in another worktree. That protection has to
# come from the caller, which is why $attached below is rebuilt from a fresh
# worktree listing rather than a stale one.
function Remove-BranchRef($name, $expectedSha) {
  git update-ref -d "refs/heads/$name" $expectedSha
  return ($LASTEXITCODE -eq 0)
}

# Hours since anything last happened in a worktree, or -1 if it cannot be
# measured. Measured from the worktree's git admin directory (.git/worktrees/
# <name>), which git rewrites on checkout, commit, fetch, and index refresh --
# so it tracks whether a SESSION is using the worktree. The branch's commit
# date would not: a session can be busy for hours without committing. The
# worktree root's own mtime would not either, since edits deep in the tree do
# not touch it.
function Get-IdleHours($worktreePath) {
  $admin = git -C $worktreePath rev-parse --absolute-git-dir 2>$null
  if ($LASTEXITCODE -ne 0) { return -1 }
  if (-not $admin) { return -1 }
  if (-not (Test-Path -LiteralPath $admin)) { return -1 }
  $newest = $null
  foreach ($f in (Get-ChildItem -LiteralPath $admin -Recurse -File -Force -ErrorAction SilentlyContinue)) {
    if (($null -eq $newest) -or ($f.LastWriteTime -gt $newest)) { $newest = $f.LastWriteTime }
  }
  if ($null -eq $newest) { return -1 }
  return [math]::Round(((Get-Date) - $newest).TotalHours, 1)
}

# Delete a directory tree that ordinary tools cannot. pnpm's node_modules
# nests past the Windows 260-character path limit, where BOTH Remove-Item and
# `cmd rmdir` fail with "cannot find the path specified" on files that exist.
# robocopy is long-path aware: mirroring an empty directory over the target
# empties it, and the remaining husk deletes normally. This was verified the
# hard way on three orphaned worktrees.
function Remove-EmptiedTree($target) {
  $empty = Join-Path $env:TEMP ('prune-empty-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $empty -Force | Out-Null
  # robocopy exits 1-7 on success; only 8+ is failure. Swallow its output and
  # its exit code so it does not read as a script failure.
  robocopy $empty $target /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'fetching origin...'
git fetch origin --prune | Out-Null

# Drop registrations whose directory is already gone BEFORE listing anything.
# Run after the loop instead, and this run still sees the dead entries: it
# cannot measure their idle time, so it reports "could not measure last
# activity" as though a live worktree were being protected.
git worktree prune

# origin/main must exist -- every merged check is relative to it.
git rev-parse --verify --quiet origin/main | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'ERROR: origin/main not found. Nothing was touched.'
  exit 1
}

$here = Norm (git rev-parse --show-toplevel)
$worktrees = Get-Worktrees

# The first record is the primary checkout. It is never a prune candidate: it
# owns the repo, and removing it would take the other worktrees with it.
$primary = Norm $worktrees[0].Path

$removed = @()
$kept = @()
$prunedBranches = @()

Write-Host ''
Write-Host '--- worktrees ---'
foreach ($w in $worktrees) {
  $p = Norm $w.Path
  if ($p -eq $primary) { $kept += "$($w.Path)  KEPT: primary checkout"; continue }
  if ($p -eq $here)    { $kept += "$($w.Path)  KEPT: this session is running in it"; continue }
  # An explicit `git worktree lock` means someone said do not remove this.
  # Honour it before any other reasoning: nothing below outranks it.
  if ($w.Locked)       { $kept += "$($w.Path)  KEPT: locked with 'git worktree lock'"; continue }
  if (-not $w.Branch)  { $kept += "$($w.Path)  KEPT: detached HEAD (nothing to judge merged)"; continue }
  if ($w.Branch -eq 'main') { $kept += "$($w.Path)  KEPT: on main"; continue }

  # Measure idleness BEFORE anything else touches this worktree. `git status`
  # can rewrite the index to refresh cached stat info, which would reset the
  # very timestamp the age guard reads and make every worktree look like it
  # was used seconds ago. (--no-optional-locks below asks git not to, but
  # measuring first is the guarantee.)
  $idle = Get-IdleHours $w.Path

  # Dirty check next -- uncommitted work is the one thing that is gone for
  # good if we get this wrong.
  # --no-optional-locks is a TOP-LEVEL git option and must come before the
  # subcommand. Putting it after `status` makes git exit with a usage error
  # and print NOTHING to stdout -- which reads as "no changes" and marks a
  # dirty worktree clean. That nearly deleted 12 uncommitted files in
  # testing, hence the exit-code check below: a check that did not run is
  # never evidence of a clean tree.
  $dirty = git -C $w.Path --no-optional-locks status --porcelain
  if ($LASTEXITCODE -ne 0) {
    $kept += "$($w.Path)  KEPT: 'git status' failed, so the tree cannot be confirmed clean"
    continue
  }
  if ($dirty) {
    $n = ($dirty | Measure-Object).Count
    $kept += "$($w.Path)  KEPT: $n uncommitted change(s) on $($w.Branch)"
    continue
  }

  git merge-base --is-ancestor $w.Head origin/main
  if ($LASTEXITCODE -ne 0) {
    $kept += "$($w.Path)  KEPT: $($w.Branch) is not merged into origin/main"
    continue
  }

  # Age guard. Everything above says "this worktree is finished"; only
  # recency distinguishes finished from paused. An unmeasurable age is
  # treated as too recent -- never guess in the direction of deleting.
  if ($MinAgeHours -gt 0) {
    if ($idle -lt 0) {
      $kept += "$($w.Path)  KEPT: could not measure last activity, so not assumed idle"
      continue
    }
    if ($idle -lt $MinAgeHours) {
      $kept += "$($w.Path)  KEPT: active $idle h ago, under the $MinAgeHours h guard (override with -MinAgeHours)"
      continue
    }
  }

  if ($DryRun) {
    Write-Host "WOULD REMOVE $($w.Path)  (branch $($w.Branch), merged + clean, idle $idle h)"
    $removed += $w.Path
    continue
  }

  git worktree remove $w.Path
  $gitRemoveFailed = ($LASTEXITCODE -ne 0)
  if ($gitRemoveFailed) {
    # A non-zero exit covers two very different situations, and finishing the
    # deletion by hand is only correct for one of them:
    #
    #  - git committed to the removal, deregistered the worktree, and then
    #    failed to rmdir the directory (the routine Windows long-path case).
    #    What is left is dead disk content and deleting it is right.
    #  - git refused outright and changed nothing -- a locked worktree, or one
    #    containing submodules. Deleting by hand here would override a refusal
    #    that exists for a reason.
    #
    # Whether the worktree is still registered separates the two exactly, and
    # does not depend on parsing git's error text.
    $stillRegistered = $false
    foreach ($x in (Get-Worktrees)) {
      if ((Norm $x.Path) -eq $p) { $stillRegistered = $true }
    }
    if ($stillRegistered) {
      $kept += "$($w.Path)  KEPT: 'git worktree remove' refused and left it registered (see its message above); not deleting by hand"
      continue
    }
  }

  if (Test-Path -LiteralPath $w.Path) {
    Remove-Item -LiteralPath $w.Path -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $w.Path) {
    Remove-EmptiedTree $w.Path
  }
  if (Test-Path -LiteralPath $w.Path) {
    $kept += "$($w.Path)  KEPT: could not delete the directory. git has already deregistered it, so the leftover is dead disk content -- delete it by hand."
    continue
  }
  if ($gitRemoveFailed) {
    Write-Host "removed worktree $($w.Path)  (git could not rmdir it; deleted the leftover directory)"
  } else {
    Write-Host "removed worktree $($w.Path)"
  }
  $removed += $w.Path

  if (Remove-BranchRef $w.Branch $w.Head) {
    Write-Host "  deleted local branch $($w.Branch)"
    $prunedBranches += $w.Branch
  } else {
    Write-Host "  local branch $($w.Branch) left alone: it moved since it was checked as merged"
  }
}
foreach ($k in $kept) { Write-Host $k }

# --- local branches with no worktree ----------------------------------------
# No age guard here on purpose. A local branch is just a ref, and every one
# deleted below is already merged into origin/main, so the commits survive in
# main and in the reflog. Nothing is lost and nothing is yanked out from under
# a session -- a branch a session has checked out is attached to a worktree
# and is skipped.
#
# That skip is load-bearing, because update-ref will happily delete a ref that
# is checked out somewhere. So rebuild the attachment map from a FRESH
# listing: another session can create a worktree while this script runs, and
# the snapshot taken at the top would not know about it.
Write-Host ''
Write-Host '--- local branches ---'
$attached = @{}
foreach ($w in (Get-Worktrees)) {
  # $removed is subtracted so a dry run reports the branches that a real run
  # would have freed up by removing their worktree.
  if ($w.Branch -and ($removed -notcontains $w.Path)) { $attached[$w.Branch] = $true }
}

foreach ($line in (git for-each-ref --format '%(refname:short) %(objectname)' refs/heads)) {
  $parts = $line.Split(' ')
  $name = $parts[0]
  $sha  = $parts[1]
  if ($name -eq 'main') { continue }
  if ($attached.ContainsKey($name)) { continue }
  if ($prunedBranches -contains $name) { continue }

  git merge-base --is-ancestor $sha origin/main
  if ($LASTEXITCODE -ne 0) {
    Write-Host "$name  KEPT: not merged into origin/main"
    continue
  }
  if ($DryRun) {
    Write-Host "WOULD DELETE branch $name (merged)"
    continue
  }
  if (Remove-BranchRef $name $sha) {
    Write-Host "deleted branch $name"
    $prunedBranches += $name
  } else {
    Write-Host "$name  KEPT: it moved since it was checked as merged"
  }
}

# --- remote branches: report only -------------------------------------------
# Not deleted here on purpose. A remote branch can belong to another session
# that is still pushing to it, and deleting it would be an outward-facing,
# hard-to-reverse action. /post-merge-cleanup deletes the one branch it owns.
Write-Host ''
Write-Host '--- remote branches merged into origin/main (report only) ---'
$anyRemote = $false
foreach ($line in (git for-each-ref --format '%(refname:short) %(objectname)' refs/remotes/origin)) {
  $parts = $line.Split(' ')
  $name = $parts[0]
  $sha  = $parts[1]
  if ($name -eq 'origin/main') { continue }
  if ($name -eq 'origin/HEAD') { continue }
  git merge-base --is-ancestor $sha origin/main
  if ($LASTEXITCODE -eq 0) {
    Write-Host "$name  (merged -- delete with: git push origin --delete $($name -replace '^origin/', ''))"
    $anyRemote = $true
  }
}
if (-not $anyRemote) { Write-Host 'none' }

Write-Host ''
if ($DryRun) {
  Write-Host 'DRY RUN: nothing was changed.'
} else {
  Write-Host "prune complete: $(($removed | Measure-Object).Count) worktree(s) removed, $(($prunedBranches | Measure-Object).Count) local branch(es) deleted."
}
exit 0
