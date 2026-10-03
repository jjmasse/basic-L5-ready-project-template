#!/usr/bin/env node
// Post-merge cleanup driver — mechanical half of the /post-merge-cleanup skill.
// Verifies the PR merged, deletes its remote branch, and polls production
// health until healthy or timeout. The judgment half (memory notes, hand-off)
// stays with the agent — see SKILL.md.
//
//   node .claude/skills/post-merge-cleanup/cleanup.mjs --pr 88
//   ... --health-url none               skip the health poll
//   ... --health-url https://x/health   override the default
//   ... --health-timeout-sec 900        poll for longer (default 600)
//
// Exit codes: 0 = merged + branch gone + prod healthy; 1 = any check failed.
//
// Runs the same on macOS, Linux, and Windows. Needs Node 20+, git, and the
// GitHub CLI (gh), nothing else.

import { spawnSync } from 'node:child_process';

const USAGE = `Usage: node .claude/skills/post-merge-cleanup/cleanup.mjs --pr <number> [--health-url <url|none>] [--health-timeout-sec <n>]`;

/** Production health URL. 'none' skips the poll (no deploy to watch). */
const DEFAULT_HEALTH_URL = '{{PROD_HEALTH_URL}}';
/** Seconds to keep polling (a build + deploy can take a few minutes). */
const DEFAULT_HEALTH_TIMEOUT_SEC = 600;
const POLL_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 15_000;

/**
 * What "healthy" means. Extend this for your project's health endpoint: a bare
 * 200 proves the process answers, not that it is doing its job. Hexreign, for
 * example, also required its tick lag to be under 2 and read a heartbeat's
 * staleness flag before trusting its duration figure.
 *
 * @param {number} status
 * @param {string} body
 */
function isHealthy(status, body) {
  if (status !== 200) return false;
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    // Not JSON: a 200 is all we can check.
    return true;
  }
  if (json !== null && typeof json === 'object' && Object.hasOwn(json, 'ok')) return Boolean(json.ok);
  return true;
}

/**
 * Run a command. stderr goes straight to the terminal so the tool's own error
 * messages stay visible. `ok` is false when the command could not be started
 * at all, not only on a non-zero exit.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ stdout?: 'pipe' | 'inherit' }} [options]
 */
function run(command, args, { stdout = 'pipe' } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', stdout, 'inherit'] });
  return { ok: result.status === 0, out: result.stdout ?? '' };
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * @param {string} flag
 * @param {string | undefined} raw
 */
function wholeNumber(flag, raw) {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isInteger(n) || n < 1) {
    throw new Error(`${flag} expects a whole number above 0, got "${raw ?? ''}"`);
  }
  return n;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ pr: number | null, healthUrl: string, healthTimeoutSec: number }} */
  const out = { pr: null, healthUrl: DEFAULT_HEALTH_URL, healthTimeoutSec: DEFAULT_HEALTH_TIMEOUT_SEC };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const value = () => (flag === arg ? argv[(i += 1)] : arg.slice(eq + 1));
    if (flag === '--pr') out.pr = wholeNumber('--pr', value());
    else if (flag === '--health-url') out.healthUrl = value() ?? '';
    else if (flag === '--health-timeout-sec') out.healthTimeoutSec = wholeNumber('--health-timeout-sec', value());
    else throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }
  if (out.pr === null) throw new Error(`--pr is required.\n\n${USAGE}`);

  // Fail now rather than after ten minutes of probes that could never work.
  if (out.healthUrl !== 'none' && out.healthUrl !== '' && !URL.canParse(out.healthUrl)) {
    throw new Error(`The health URL "${out.healthUrl}" is not a URL. Pass --health-url <url>, or --health-url none to skip the deploy watch.`);
  }
  return /** @type {{ pr: number, healthUrl: string, healthTimeoutSec: number }} */ (out);
}

/** @returns {Promise<number>} the exit code */
async function main() {
  const { pr, healthUrl, healthTimeoutSec } = parseArgs(process.argv.slice(2));

  // 1. The PR must actually be merged — never clean up an open branch.
  const view = run('gh', ['pr', 'view', String(pr), '--json', 'state,mergedAt,mergeCommit,headRefName']);
  if (!view.ok) {
    console.log(`could not read PR #${pr} with gh (see its message above) — stopping. Nothing was deleted.`);
    return 1;
  }
  const info = JSON.parse(view.out);
  if (info.state !== 'MERGED') {
    console.log(`PR #${pr} state is '${info.state}', not MERGED — stopping. Nothing was deleted.`);
    return 1;
  }
  console.log(`PR #${pr} merged at ${info.mergedAt} as ${info.mergeCommit.oid.slice(0, 7)}`);

  // 2. Delete the remote branch (idempotent: skip if GitHub already deleted it).
  run('git', ['fetch', 'origin', '--prune'], { stdout: 'inherit' });
  const branch = info.headRefName;
  // The full ref name, because a bare `<branch>` pattern also matches any
  // branch whose name ends in `/<branch>`.
  const exists = run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  if (!exists.ok) {
    console.log(`could not check whether origin/${branch} exists (see git's message above) — stopping.`);
    return 1;
  }
  if (exists.out.trim() !== '') {
    if (!run('git', ['push', 'origin', '--delete', branch], { stdout: 'inherit' }).ok) {
      console.log(`could not delete origin/${branch} (see git's message above) — stopping.`);
      return 1;
    }
    console.log(`deleted origin/${branch}`);
  } else {
    console.log(`origin/${branch} already deleted`);
  }

  // 3. Poll production health until healthy.
  if (healthUrl === 'none' || healthUrl === '') {
    console.log('no health URL configured: skipping the deploy watch.');
    console.log('cleanup complete: PR merged, branch deleted.');
    return 0;
  }

  const deadline = Date.now() + healthTimeoutSec * 1000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const body = await response.text();
      console.log(`health: ${response.status} ${body}`);
      if (isHealthy(response.status, body)) {
        healthy = true;
        break;
      }
    } catch (err) {
      // fetch puts the useful part (refused, DNS, TLS) in `cause`.
      const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
      console.log(`health probe failed: ${err instanceof Error ? err.message : String(err)}${cause}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (!healthy) {
    console.log(`PROD NOT HEALTHY within ${healthTimeoutSec} s — alert the owner, see planning/RUNBOOK-release.md for rollback.`);
    return 1;
  }
  console.log('cleanup complete: PR merged, branch deleted, prod healthy.');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
