#!/usr/bin/env node
// Workspace prune — phase 9 of the /dev-loop skill.
//
// Removes worktrees whose branch is already merged into origin/main AND whose
// working tree is clean AND which have been idle long enough. Then deletes the
// local branches that no worktree is using. Anything unmerged, dirty, locked,
// detached, recently active, or in use is REPORTED and left alone. Remote
// branches are only reported: other sessions may still be pushing to them.
//
// "Merged" means the branch tip is an ancestor of origin/main. That is exact
// for this repo because PRs land as merge commits (the convention recorded in
// /review-and-ship). A squash- or rebase-merged branch will NOT look merged
// here, so it gets kept and reported rather than wrongly deleted.
//
//   node .claude/skills/dev-loop/prune.mjs                     prune
//   node .claude/skills/dev-loop/prune.mjs --dry-run           show what would go
//   node .claude/skills/dev-loop/prune.mjs --min-age-hours 0   skip the age guard
//
// Exit codes: 0 = ran to completion (even if nothing was prunable); 1 = error.
//
// Runs the same on macOS, Linux, and Windows. Needs Node 20+ and git, nothing
// else — dependency-free on purpose, like the other scripts in this repo.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const USAGE = `Usage: node .claude/skills/dev-loop/prune.mjs [--dry-run] [--min-age-hours <n>]

  --dry-run            Show what would be removed without removing anything.
  --min-age-hours <n>  Leave worktrees alone until they have been idle this
                       many hours (default 12). 0 disables the guard.`;

/**
 * Leave worktrees alone until they have been idle this many hours. Guards
 * against yanking a worktree out from under another live session: a session
 * that is between edits looks exactly like an abandoned one (clean tree,
 * branch merged), and only recency separates them. 0 disables the guard.
 */
const DEFAULT_MIN_AGE_HOURS = 12;

/**
 * Run git. stderr goes straight to the terminal so git's own error messages
 * stay visible, as they would in a shell.
 *
 * `ok` is false when git could not be started at all, not only on a non-zero
 * exit: a check that did not run is never evidence of anything.
 *
 * @param {string[]} args
 * @param {{ stdout?: 'pipe' | 'inherit' | 'ignore', stderr?: 'inherit' | 'ignore' }} [options]
 */
function git(args, { stdout = 'pipe', stderr = 'inherit' } = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', stdout, stderr],
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, out: result.stdout ?? '' };
}

/** @param {string} text */
function linesOf(text) {
  return text.split(/\r?\n/).filter((line) => line !== '');
}

/**
 * A path in a form that compares equal however git or the OS spelled it.
 *
 *   - realpath resolves symlinks: on macOS, /tmp is a link to /private/tmp,
 *     and different git commands report either spelling.
 *   - `\` becomes `/`: git on Windows mixes the two.
 *   - Lowercased, because Windows and macOS file systems ignore case. On a
 *     case-sensitive file system this can only make two different paths look
 *     the same, and every comparison below treats "same" as "keep it", so the
 *     error is always in the safe direction.
 *
 * @param {string | undefined} p
 */
function norm(p) {
  if (!p) return '';
  let resolved = p;
  try {
    resolved = realpathSync.native(p);
  } catch {
    // Gone or unreadable: compare it as given.
  }
  return resolved.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Parse `git worktree list --porcelain` into records. Called more than once:
 * the workspace changes while this script runs, and decisions must be made
 * against the CURRENT state rather than a snapshot taken minutes earlier.
 *
 * The `locked` attribute matters and used to be dropped here. It is git's
 * explicit "do not remove this worktree" marker, set by `git worktree lock`.
 *
 * Throws if git fails, rather than returning an empty list. An empty list
 * would read as "no branch is checked out anywhere", and the local-branch
 * pass below relies on this listing to avoid deleting a checked-out branch.
 *
 * @returns {{ path: string, head: string, branch: string, locked: boolean }[]}
 */
function getWorktrees() {
  const listing = git(['worktree', 'list', '--porcelain']);
  if (!listing.ok) throw new Error("'git worktree list' failed, so the workspace cannot be read.");
  /** @type {{ path: string, head: string, branch: string, locked: boolean }[]} */
  const list = [];
  /** @type {{ path: string, head: string, branch: string, locked: boolean } | null} */
  let cur = null;
  for (const line of linesOf(listing.out)) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length), head: '', branch: '', locked: false };
      list.push(cur);
    } else if (cur === null) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'locked' || line.startsWith('locked ')) {
      // Emitted bare, or with a reason: "locked" / "locked <reason>".
      cur.locked = true;
    }
  }
  return list;
}

/**
 * Delete a branch ref only if it still points where we verified it. Plain
 * `git branch -D` deletes by name, so a commit made between the merged check
 * and the delete would be discarded without ever being checked. update-ref's
 * compare-and-delete form fails instead, which is the outcome we want.
 *
 * One thing update-ref does NOT do that `git branch -d` does: refuse to delete
 * a branch that is checked out in another worktree. That protection has to
 * come from the caller, which is why `attached` below is rebuilt from a fresh
 * worktree listing rather than a stale one.
 *
 * @param {string} name
 * @param {string} expectedSha
 */
function removeBranchRef(name, expectedSha) {
  return git(['update-ref', '-d', `refs/heads/${name}`, expectedSha]).ok;
}

/**
 * Newest file modification time under `dir`, in milliseconds, or null if
 * there is no readable file.
 *
 * @param {string} dir
 * @returns {number | null}
 */
function newestMtime(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  /** @type {number | null} */
  let newest = null;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    /** @type {number | null} */
    let candidate = null;
    if (entry.isDirectory()) {
      candidate = newestMtime(full);
    } else if (entry.isFile()) {
      try {
        candidate = statSync(full).mtimeMs;
      } catch {
        // Vanished mid-walk.
      }
    }
    if (candidate !== null && (newest === null || candidate > newest)) newest = candidate;
  }
  return newest;
}

/**
 * Hours since anything last happened in a worktree, or -1 if it cannot be
 * measured. Measured from the worktree's git admin directory (.git/worktrees/
 * <name>), which git rewrites on checkout, commit, fetch, and index refresh —
 * so it tracks whether a SESSION is using the worktree. The branch's commit
 * date would not: a session can be busy for hours without committing. The
 * worktree root's own mtime would not either, since edits deep in the tree do
 * not touch it.
 *
 * @param {string} worktreePath
 */
function getIdleHours(worktreePath) {
  const admin = git(['-C', worktreePath, 'rev-parse', '--absolute-git-dir'], { stderr: 'ignore' });
  if (!admin.ok) return -1;
  const dir = admin.out.trim();
  if (!dir || !existsSync(dir)) return -1;
  const newest = newestMtime(dir);
  if (newest === null) return -1;
  return Math.round(((Date.now() - newest) / 3_600_000) * 10) / 10;
}

/**
 * Delete a directory tree. Returns true when it is gone.
 *
 * Node's rm handles deep trees on every platform, including paths past the
 * Windows 260-character limit, and removes a junction or symlink without
 * following it out of the tree.
 *
 * The robocopy step is a Windows-only fallback kept from the PowerShell
 * version of this script, for the case it was written for: pnpm's
 * node_modules nests past the 260-character limit, where Remove-Item and
 * `cmd rmdir` both failed with "cannot find the path specified" on files that
 * exist. robocopy is long-path aware: mirroring an empty directory over the
 * target empties it, and what is left then deletes normally. That was
 * verified the hard way on three orphaned worktrees.
 *
 * @param {string} target
 */
function removeDirectory(target) {
  const attempt = () => {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Whether it worked is checked by the caller's existsSync.
    }
  };
  attempt();
  if (existsSync(target) && process.platform === 'win32') {
    const empty = mkdtempSync(join(tmpdir(), 'prune-empty-'));
    // robocopy exits 1-7 on success; only 8+ is failure. Its output and exit
    // code are ignored so they do not read as a script failure; whether the
    // target is gone is checked below.
    spawnSync('robocopy', [empty, resolve(target), '/MIR', '/R:0', '/W:0', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {
      stdio: 'ignore',
    });
    attempt();
    rmSync(empty, { recursive: true, force: true });
  }
  return !existsSync(target);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const out = { dryRun: false, minAgeHours: DEFAULT_MIN_AGE_HOURS, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--min-age-hours' || arg.startsWith('--min-age-hours=')) {
      const raw = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[(i += 1)];
      const hours = Number(raw);
      if (raw === undefined || raw === '' || !Number.isInteger(hours) || hours < 0) {
        throw new Error(`--min-age-hours expects a whole number of hours, got "${raw ?? ''}"`);
      }
      out.minAgeHours = hours;
    } else throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }
  return out;
}

/** @returns {number} the exit code */
function main() {
  const { dryRun, minAgeHours, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(USAGE);
    return 0;
  }

  console.log('fetching origin...');
  git(['fetch', 'origin', '--prune'], { stdout: 'ignore' });

  // Drop registrations whose directory is already gone BEFORE listing anything.
  // Run after the loop instead, and this run still sees the dead entries: it
  // cannot measure their idle time, so it reports "could not measure last
  // activity" as though a live worktree were being protected.
  git(['worktree', 'prune'], { stdout: 'inherit' });

  // origin/main must exist — every merged check is relative to it.
  if (!git(['rev-parse', '--verify', '--quiet', 'origin/main']).ok) {
    console.log('ERROR: origin/main not found. Nothing was touched.');
    return 1;
  }

  // Without this, the worktree this session runs in has no protection below.
  const toplevel = git(['rev-parse', '--show-toplevel']);
  if (!toplevel.ok || toplevel.out.trim() === '') {
    console.log('ERROR: could not tell which worktree this is running in. Nothing was touched.');
    return 1;
  }
  const here = norm(toplevel.out.trim());
  const worktrees = getWorktrees();

  // The first record is the primary checkout. It is never a prune candidate: it
  // owns the repo, and removing it would take the other worktrees with it.
  const primary = norm(worktrees[0]?.path);

  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const kept = [];
  /** @type {string[]} */
  const prunedBranches = [];

  console.log('');
  console.log('--- worktrees ---');
  for (const w of worktrees) {
    const p = norm(w.path);
    if (p === primary) { kept.push(`${w.path}  KEPT: primary checkout`); continue; }
    if (p === here) { kept.push(`${w.path}  KEPT: this session is running in it`); continue; }
    // An explicit `git worktree lock` means someone said do not remove this.
    // Honour it before any other reasoning: nothing below outranks it.
    if (w.locked) { kept.push(`${w.path}  KEPT: locked with 'git worktree lock'`); continue; }
    if (!w.branch) { kept.push(`${w.path}  KEPT: detached HEAD (nothing to judge merged)`); continue; }
    if (w.branch === 'main') { kept.push(`${w.path}  KEPT: on main`); continue; }

    // Measure idleness BEFORE anything else touches this worktree. `git status`
    // can rewrite the index to refresh cached stat info, which would reset the
    // very timestamp the age guard reads and make every worktree look like it
    // was used seconds ago. (--no-optional-locks below asks git not to, but
    // measuring first is the guarantee.)
    const idle = getIdleHours(w.path);

    // Dirty check next — uncommitted work is the one thing that is gone for
    // good if we get this wrong.
    // --no-optional-locks is a TOP-LEVEL git option and must come before the
    // subcommand. Putting it after `status` makes git exit with a usage error
    // and print NOTHING to stdout — which reads as "no changes" and marks a
    // dirty worktree clean. That nearly deleted 12 uncommitted files in
    // testing, hence the exit-code check below: a check that did not run is
    // never evidence of a clean tree.
    const status = git(['-C', w.path, '--no-optional-locks', 'status', '--porcelain']);
    if (!status.ok) {
      kept.push(`${w.path}  KEPT: 'git status' failed, so the tree cannot be confirmed clean`);
      continue;
    }
    const dirty = linesOf(status.out);
    if (dirty.length > 0) {
      kept.push(`${w.path}  KEPT: ${dirty.length} uncommitted change(s) on ${w.branch}`);
      continue;
    }

    if (!git(['merge-base', '--is-ancestor', w.head, 'origin/main']).ok) {
      kept.push(`${w.path}  KEPT: ${w.branch} is not merged into origin/main`);
      continue;
    }

    // Age guard. Everything above says "this worktree is finished"; only
    // recency distinguishes finished from paused. An unmeasurable age is
    // treated as too recent — never guess in the direction of deleting.
    if (minAgeHours > 0) {
      if (idle < 0) {
        kept.push(`${w.path}  KEPT: could not measure last activity, so not assumed idle`);
        continue;
      }
      if (idle < minAgeHours) {
        kept.push(`${w.path}  KEPT: active ${idle} h ago, under the ${minAgeHours} h guard (override with --min-age-hours)`);
        continue;
      }
    }

    if (dryRun) {
      console.log(`WOULD REMOVE ${w.path}  (branch ${w.branch}, merged + clean, idle ${idle} h)`);
      removed.push(w.path);
      continue;
    }

    const gitRemoveFailed = !git(['worktree', 'remove', w.path], { stdout: 'inherit' }).ok;
    if (gitRemoveFailed) {
      // A non-zero exit covers two very different situations, and finishing the
      // deletion by hand is only correct for one of them:
      //
      //  - git committed to the removal, deregistered the worktree, and then
      //    failed to delete the directory (the routine case for a long-path
      //    node_modules on Windows). What is left is dead disk content and
      //    deleting it is right.
      //  - git refused outright and changed nothing — a locked worktree, or one
      //    containing submodules. Deleting by hand here would override a refusal
      //    that exists for a reason.
      //
      // Whether the worktree is still registered separates the two exactly, and
      // does not depend on parsing git's error text.
      const stillRegistered = getWorktrees().some((x) => norm(x.path) === p);
      if (stillRegistered) {
        kept.push(`${w.path}  KEPT: 'git worktree remove' refused and left it registered (see its message above); not deleting by hand`);
        continue;
      }
    }

    if (existsSync(w.path) && !removeDirectory(w.path)) {
      kept.push(`${w.path}  KEPT: could not delete the directory. git has already deregistered it, so the leftover is dead disk content — delete it by hand.`);
      continue;
    }
    if (gitRemoveFailed) {
      console.log(`removed worktree ${w.path}  (git could not delete it; deleted the leftover directory)`);
    } else {
      console.log(`removed worktree ${w.path}`);
    }
    removed.push(w.path);
    // Its branch is deleted by the local-branch pass below, not here.
  }
  for (const line of kept) console.log(line);

  // --- local branches with no worktree ----------------------------------------
  // No age guard here on purpose. A local branch is just a ref, and every one
  // deleted below is already merged into origin/main, so the commits survive in
  // main and in the reflog. Nothing is lost and nothing is yanked out from under
  // a session — a branch a session has checked out is attached to a worktree
  // and is skipped.
  //
  // That skip matters, because update-ref will happily delete a ref that is
  // checked out somewhere. So rebuild the attachment map from a FRESH listing:
  // another session can create or move a worktree while this script runs, and
  // the snapshot taken at the top would not know about it.
  //
  // This pass also deletes the branches of the worktrees removed above. Doing
  // it here, and not right after each removal, sends every branch delete
  // through this one fresh check.
  //
  // Refs are read by their full name and trimmed here, not with
  // %(refname:short): that form abbreviates to whatever is unambiguous, so a
  // branch that shares a name with a tag comes back as `heads/<name>`, and
  // origin/HEAD comes back as plain `origin`.
  console.log('');
  console.log('--- local branches ---');
  /** @type {Set<string>} */
  const attached = new Set();
  for (const w of getWorktrees()) {
    // `removed` is subtracted so a dry run reports the branches that a real run
    // would have freed up by removing their worktree.
    if (w.branch && !removed.includes(w.path)) attached.add(w.branch);
  }

  for (const line of linesOf(git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']).out)) {
    const [ref, sha] = line.split(' ');
    const name = ref.replace(/^refs\/heads\//, '');
    if (name === 'main') continue;
    if (attached.has(name)) continue;

    if (!git(['merge-base', '--is-ancestor', sha, 'origin/main']).ok) {
      console.log(`${name}  KEPT: not merged into origin/main`);
      continue;
    }
    if (dryRun) {
      console.log(`WOULD DELETE branch ${name} (merged)`);
      continue;
    }
    if (removeBranchRef(name, sha)) {
      console.log(`deleted branch ${name}`);
      prunedBranches.push(name);
    } else {
      console.log(`${name}  KEPT: it moved since it was checked as merged`);
    }
  }

  // --- remote branches: report only -------------------------------------------
  // Not deleted here on purpose. A remote branch can belong to another session
  // that is still pushing to it, and deleting it would be an outward-facing,
  // hard-to-reverse action. /post-merge-cleanup deletes the one branch it owns.
  console.log('');
  console.log('--- remote branches merged into origin/main (report only) ---');
  let anyRemote = false;
  for (const line of linesOf(git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/origin']).out)) {
    const [ref, sha] = line.split(' ');
    const name = ref.replace(/^refs\/remotes\//, '');
    if (name === 'origin/main' || name === 'origin/HEAD') continue;
    if (git(['merge-base', '--is-ancestor', sha, 'origin/main']).ok) {
      console.log(`${name}  (merged — delete with: git push origin --delete ${name.replace(/^origin\//, '')})`);
      anyRemote = true;
    }
  }
  if (!anyRemote) console.log('none');

  console.log('');
  if (dryRun) {
    console.log('DRY RUN: nothing was changed.');
  } else {
    console.log(`prune complete: ${removed.length} worktree(s) removed, ${prunedBranches.length} local branch(es) deleted.`);
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
