#!/usr/bin/env node
// PreToolUse hook: refuse `git stash` and its work-moving subcommands.
//
// Why this exists. Git's stash stack belongs to the repository, not to the
// worktree. Several agent sessions work in worktrees of this repository at the
// same time (see CLAUDE.md, "Local dev ports on the product owner's machine"),
// so one session running `git stash` with nothing to stash pushes nothing, and
// its next `git stash pop` applies a *different session's* uncommitted work
// into its own tree. The session that lost the work gets no signal at all, and
// the work can ride out in an unrelated pull request.
//
// Nothing in this repository's normal workflow uses `git stash` — no skill, no
// scheduled task, no script — so this hook needs no escape hatch. Parking work
// is done with a scratch branch or a worktree, both already in use here.
//
// This is a *strong default, not a guarantee*: a PreToolUse hook sees tool
// calls, so a script that stashes internally still gets through. Widening the
// matcher to chase that would trade real accidents for a new class of false
// blocks, which is the wrong trade for this repository's first hook.
//
// The reasoning above is the record, because the hazard is written down
// nowhere else in the repository.

/** Git's own options that take a separate value, so the value is not a subcommand. */
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
]);

/** Wrappers that may sit in front of `git` without changing what is being run. */
const COMMAND_PREFIXES = new Set(['sudo', 'env', 'command', 'time', 'nohup']);

/**
 * `git stash` subcommands that only read. These cannot move anyone's work, so
 * blocking them would be over-broad for no gain.
 */
const READ_ONLY_SUBCOMMANDS = new Set(['list', 'show', '--help', '-h']);

/** The tools this hook inspects. Both are used to drive git in this project. */
const WATCHED_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * Split a shell command into segments of tokens, honouring quotes.
 *
 * Two properties matter for the matcher, and both are the reason this is a real
 * tokenizer rather than a substring search:
 *   - a token records whether any of it came from inside quotes, so
 *     `echo "git stash pop"` is one quoted token and never reads as a command;
 *   - unquoted `;`, `|`, `&`, newlines and brackets start a new segment, so
 *     `cd x && git stash pop` is still caught.
 *
 * The escape character differs by shell and it matters here, because this is a
 * Windows project: in PowerShell `\` is an ordinary character, so treating it as
 * an escape would turn `C:\tools\git.exe` into `C:toolsgit.exe` and the program
 * would stop reading as git.
 *
 * @param {string} command
 * @param {string} escapeChar
 * @returns {{ text: string, quoted: boolean }[][]}
 */
export function segmentsOf(command, escapeChar = '\\') {
  /** @type {{ text: string, quoted: boolean }[][]} */
  const segments = [];
  /** @type {{ text: string, quoted: boolean }[]} */
  let current = [];
  let text = '';
  let quoted = false;
  let started = false;
  /** @type {string | null} */
  let openQuote = null;

  const endToken = () => {
    if (started) current.push({ text, quoted });
    text = '';
    quoted = false;
    started = false;
  };
  const endSegment = () => {
    endToken();
    if (current.length > 0) segments.push(current);
    current = [];
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (openQuote !== null) {
      if (char === openQuote) openQuote = null;
      else {
        text += char;
        started = true;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      openQuote = char;
      quoted = true;
      started = true;
      continue;
    }
    if (char === escapeChar && i + 1 < command.length) {
      // A line continuation joins one command across two lines, so it must not
      // leave a token behind: `git \<newline>stash pop` is `git stash pop`.
      if (command[i + 1] === '\n' || (command[i + 1] === '\r' && command[i + 2] === '\n')) {
        i += command[i + 1] === '\r' ? 2 : 1;
        continue;
      }
      text += command[i + 1];
      started = true;
      i += 1;
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      endToken();
      continue;
    }
    if ('\n;|&(){}'.includes(char)) {
      endSegment();
      continue;
    }

    text += char;
    started = true;
  }

  endSegment();
  return segments;
}

/** `/usr/bin/git` and `C:\tools\git.exe` are both `git`. */
function programName(token) {
  const base = token.split(/[/\\]/).pop() ?? token;
  return base.toLowerCase().replace(/\.exe$/, '');
}

/**
 * The stash subcommand this segment would run, or null if it runs none.
 *
 * @param {{ text: string, quoted: boolean }[]} tokens
 * @returns {string | null}
 */
function stashSubcommandOf(tokens) {
  let i = 0;

  // Leading environment assignments: `MSYS_NO_PATHCONV=1 git ...`
  while (i < tokens.length && !tokens[i].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].text)) i += 1;
  // Wrappers: `sudo git ...`
  while (i < tokens.length && !tokens[i].quoted && COMMAND_PREFIXES.has(programName(tokens[i].text))) i += 1;

  const program = tokens[i];
  if (program === undefined || program.quoted || programName(program.text) !== 'git') return null;
  i += 1;

  // Git's own options come before the subcommand: `git -C some/dir stash pop`.
  while (i < tokens.length && tokens[i].text.startsWith('-')) {
    i += GIT_GLOBAL_OPTIONS_WITH_VALUE.has(tokens[i].text) ? 2 : 1;
  }

  if (tokens[i] === undefined || tokens[i].text !== 'stash') return null;

  const subcommand = tokens[i + 1]?.text ?? '';
  if (READ_ONLY_SUBCOMMANDS.has(subcommand)) return null;
  return subcommand;
}

/**
 * Decide whether a tool call should be refused.
 *
 * @param {string} toolName
 * @param {string} command
 * @returns {{ blocked: false } | { blocked: true, subcommand: string }}
 */
export function decide(toolName, command) {
  if (!WATCHED_TOOLS.has(toolName) || typeof command !== 'string') return { blocked: false };

  // PowerShell escapes with a backtick and leaves `\` alone; Bash uses `\`.
  const escapeChar = toolName === 'PowerShell' ? '`' : '\\';

  for (const tokens of segmentsOf(command, escapeChar)) {
    const subcommand = stashSubcommandOf(tokens);
    if (subcommand !== null) return { blocked: true, subcommand };
  }
  return { blocked: false };
}

/**
 * The refusal the session reads. It states the hazard and names the
 * alternative, because arriving at the moment of the mistake is the whole
 * reason this is a hook and not a line of prose.
 *
 * @param {string} subcommand
 */
export function refusalMessage(subcommand) {
  const what = subcommand === '' ? 'git stash (an implicit `git stash push`)' : `git stash ${subcommand}`;
  return [
    `Refused: ${what}.`,
    '',
    "Git's stash stack belongs to the repository, not to the worktree, and several sessions",
    'work in worktrees of this repository at once. A stash with nothing to stash pushes nothing,',
    "and the next pop applies another session's uncommitted work into your tree — silently, with",
    'no signal to the session you took it from.',
    '',
    'Park work on a scratch branch instead (`git switch -c wip/<name>` and commit), or use a',
    'separate worktree. `git stash list` and `git stash show` are not blocked.',
  ].join('\n');
}

/** Cases the matcher must get right. Run with `--self-test`. */
const SELF_TEST_CASES = [
  // Blocked: the work-moving forms.
  { tool: 'Bash', command: 'git stash', blocked: true },
  { tool: 'Bash', command: 'git stash push -m wip', blocked: true },
  { tool: 'Bash', command: 'git stash pop', blocked: true },
  { tool: 'Bash', command: 'git stash apply', blocked: true },
  { tool: 'Bash', command: 'git stash drop', blocked: true },
  { tool: 'Bash', command: 'git stash clear', blocked: true },
  { tool: 'Bash', command: 'git stash save "wip"', blocked: true },
  { tool: 'Bash', command: 'git stash -p', blocked: true },
  { tool: 'PowerShell', command: 'git stash pop', blocked: true },
  // Blocked even when it is not the first thing on the line.
  { tool: 'Bash', command: 'cd apps/server && git stash pop', blocked: true },
  { tool: 'Bash', command: 'git status; git stash', blocked: true },
  { tool: 'Bash', command: 'git fetch origin\ngit stash pop', blocked: true },
  // Blocked through the forms that hide the program name.
  { tool: 'Bash', command: 'git -C /repo stash pop', blocked: true },
  { tool: 'Bash', command: 'git --git-dir=/repo/.git stash pop', blocked: true },
  { tool: 'Bash', command: 'MSYS_NO_PATHCONV=1 git stash pop', blocked: true },
  { tool: 'Bash', command: '/usr/bin/git stash pop', blocked: true },
  { tool: 'PowerShell', command: '& git stash pop', blocked: true },
  // Blocked through the two shell forms that a naive tokenizer loses.
  { tool: 'PowerShell', command: 'C:\\Program\\Git\\bin\\git.exe stash pop', blocked: true },
  { tool: 'Bash', command: 'git \\\n  stash pop', blocked: true },
  { tool: 'PowerShell', command: 'git `\n  stash pop', blocked: true },
  // Allowed: the read-only stash subcommands the done bar keeps working.
  { tool: 'Bash', command: 'git stash list', blocked: false },
  { tool: 'Bash', command: 'git stash show -p', blocked: false },
  { tool: 'PowerShell', command: 'git stash list', blocked: false },
  // Allowed: the over-broad-matcher failures this hook must not make.
  { tool: 'Bash', command: 'git log --grep=stash', blocked: false },
  { tool: 'Bash', command: 'git log --oneline | grep stash', blocked: false },
  { tool: 'Bash', command: 'echo "git stash pop"', blocked: false },
  { tool: 'Bash', command: "echo 'run git stash pop to recover'", blocked: false },
  { tool: 'Bash', command: 'git add stash.txt', blocked: false },
  { tool: 'Bash', command: 'cat planning/BUILD-SPEC.md', blocked: false },
  { tool: 'Bash', command: 'git commit -m "note: git stash is blocked"', blocked: false },
  // Allowed: other tools are none of this hook's business.
  { tool: 'Read', command: 'git stash pop', blocked: false },
  { tool: 'Edit', command: 'git stash pop', blocked: false },
];

function runSelfTest() {
  const failures = SELF_TEST_CASES.filter(
    (testCase) => decide(testCase.tool, testCase.command).blocked !== testCase.blocked,
  );
  for (const failure of failures) {
    const expected = failure.blocked ? 'blocked' : 'allowed';
    console.error(`FAIL  ${failure.tool}: ${failure.command}  (expected ${expected})`);
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${SELF_TEST_CASES.length} cases failed.`);
    process.exit(1);
  }
  console.log(`ok — ${SELF_TEST_CASES.length} cases`);
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
  });
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  // A hook that throws would break every tool call in every session at once, so
  // anything that goes wrong in here allows the call through. The cost of
  // failing open is the hazard we already live with; the cost of failing closed
  // is the repository. The whole body is guarded, not only the parse, because
  // "it cannot throw" is not something worth betting every session on.
  try {
    const payload = JSON.parse(await readStdin());
    const verdict = decide(payload?.tool_name, payload?.tool_input?.command);
    if (!verdict.blocked) return;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: refusalMessage(verdict.subcommand),
        },
      }),
    );
  } catch {
    // Allow the call.
  }
}

main();
