#!/usr/bin/env node
// Fill the template's placeholders in one pass.
//
//   node scripts/init-template.mjs             interactive: prompts for each value
//   node scripts/init-template.mjs --set K=V   non-interactive (repeat --set)
//   node scripts/init-template.mjs --list      print the placeholder names
//   node scripts/init-template.mjs --check     exit 1 if any placeholder remains
//
// A placeholder is written as two braces around an UPPER_SNAKE name. This file
// builds that pattern from pieces so it never contains one itself, and the
// check skips .git, node_modules, this script, and the checklist that
// documents the names without braces.
//
// Dependency-free on purpose: it has to run on a machine that has nothing but
// Node installed yet. Delete it (and templates/) once the checklist is done.

import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const OPEN = '{'.repeat(2);
const CLOSE = '}'.repeat(2);
const TOKEN = new RegExp(`\\{\\{([A-Z][A-Z0-9_]*)\\}\\}`, 'g');

/** Order matters: later defaults derive from earlier answers. */
const PLACEHOLDERS = [
  { key: 'PROJECT_NAME', ask: 'Product name (user-facing)', example: 'Hexreign' },
  {
    key: 'PROJECT_SLUG',
    ask: 'Kebab-case identifier (markers, temp files)',
    example: 'hexreign',
    derive: (a) => slugify(a.PROJECT_NAME),
  },
  { key: 'PROJECT_DESCRIPTION', ask: 'One or two sentences: what it is, who it is for' },
  { key: 'OWNER_NAME', ask: "Product owner's first name" },
  { key: 'GITHUB_OWNER', ask: 'GitHub user or org' },
  { key: 'GITHUB_REPO', ask: 'Repository name', derive: (a) => a.PROJECT_SLUG },
  { key: 'STACK_SUMMARY', ask: 'One paragraph: the locked stack and layout' },
  { key: 'VERIFY_COMMAND', ask: 'Full local gate, one shell line', example: 'pnpm typecheck && pnpm lint && pnpm test' },
  { key: 'DEV_COMMAND', ask: 'How to run locally', example: 'pnpm dev' },
  { key: 'DEPLOY_PLATFORM', ask: 'Where production runs (or none)', example: 'Railway' },
  { key: 'PROD_HEALTH_URL', ask: 'Production health URL (or none)', example: 'https://app.example.com/health' },
  { key: 'OWNER_PORTS', ask: "Ports reserved for the owner's local (or none)", example: '3000 (API) and 5173 (web)' },
];

const SKIP_DIRS = new Set(['.git', 'node_modules', '.pnpm-store', 'dist', 'build', 'coverage']);
const SKIP_FILES = new Set([SELF, join(ROOT, 'TEMPLATE-CHECKLIST.md')]);

function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full);
    } else if (!SKIP_FILES.has(full)) {
      yield full;
    }
  }
}

function isText(buf) {
  // Good enough: a NUL byte in the first 8KB means binary.
  return !buf.subarray(0, 8192).includes(0);
}

function findRemaining() {
  const found = new Map(); // name -> [files]
  for (const file of walk(ROOT)) {
    const buf = readFileSync(file);
    if (!isText(buf)) continue;
    const text = buf.toString('utf8');
    for (const match of text.matchAll(TOKEN)) {
      const name = match[1];
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(relative(ROOT, file).split(sep).join('/'));
    }
  }
  return found;
}

function parseArgs(argv) {
  const out = { set: {}, list: false, check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') out.list = true;
    else if (arg === '--check') out.check = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--set') {
      const kv = argv[i + 1] ?? '';
      i += 1;
      const eq = kv.indexOf('=');
      if (eq < 1) throw new Error(`--set expects KEY=VALUE, got "${kv}"`);
      out.set[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (arg.startsWith('--set=')) {
      const kv = arg.slice('--set='.length);
      const eq = kv.indexOf('=');
      if (eq < 1) throw new Error(`--set expects KEY=VALUE, got "${kv}"`);
      out.set[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

async function collect(preset) {
  const answers = {};
  const interactive = process.stdin.isTTY;
  for (const p of PLACEHOLDERS) {
    if (preset[p.key] !== undefined) {
      answers[p.key] = preset[p.key];
      continue;
    }
    const derived = p.derive ? p.derive(answers) : '';
    if (!interactive) {
      if (derived) {
        answers[p.key] = derived;
        continue;
      }
      throw new Error(`Missing --set ${p.key}=... (no terminal to prompt on)`);
    }
    const hint = derived ? ` [${derived}]` : p.example ? ` (e.g. ${p.example})` : '';
    let value = (await prompt(`${p.ask}${hint}: `)).trim();
    if (!value && derived) value = derived;
    while (!value) value = (await prompt(`  ${p.key} is required: `)).trim();
    answers[p.key] = value;
  }
  return answers;
}

function apply(answers) {
  const unknown = Object.keys(answers).filter((k) => !PLACEHOLDERS.some((p) => p.key === k));
  if (unknown.length) throw new Error(`Unknown placeholder(s): ${unknown.join(', ')}`);
  let files = 0;
  let replacements = 0;
  for (const file of walk(ROOT)) {
    const buf = readFileSync(file);
    if (!isText(buf)) continue;
    const before = buf.toString('utf8');
    let count = 0;
    const after = before.replace(TOKEN, (whole, name) => {
      if (answers[name] === undefined) return whole;
      count += 1;
      return answers[name];
    });
    if (count > 0) {
      writeFileSync(file, after);
      files += 1;
      replacements += count;
    }
  }
  return { files, replacements };
}

function swapReadme() {
  const skeleton = join(ROOT, 'templates', 'README.project.md');
  if (!existsSync(skeleton)) return false;
  writeFileSync(join(ROOT, 'README.md'), readFileSync(skeleton));
  unlinkSync(skeleton);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(SELF, 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  if (args.list) {
    for (const p of PLACEHOLDERS) console.log(`${OPEN}${p.key}${CLOSE}  ${p.ask}`);
    return;
  }
  if (args.check) {
    const remaining = findRemaining();
    if (remaining.size === 0) return;
    for (const [name, files] of remaining) {
      console.error(`${OPEN}${name}${CLOSE} remains in: ${[...files].join(', ')}`);
    }
    console.error(`\n${remaining.size} placeholder(s) unfilled. Run: node scripts/init-template.mjs`);
    process.exit(1);
  }

  const answers = await collect(args.set);
  const readmeSwapped = swapReadme();
  const { files, replacements } = apply(answers);
  console.log(`filled ${replacements} placeholder(s) across ${files} file(s).`);
  if (readmeSwapped) console.log('README.md replaced with the project README skeleton.');
  const remaining = findRemaining();
  if (remaining.size > 0) {
    console.log(`still unfilled: ${[...remaining.keys()].join(', ')}`);
  }
  console.log('Next: work through TEMPLATE-CHECKLIST.md, then delete it, templates/, and this script.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
