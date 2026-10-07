import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MIN_CLAUDE_VERSION,
  compareVersions,
  findPlugin,
  formatCommand,
  helpText,
  installPlan,
  invocation,
  parseMarketplaceList,
  parsePluginList,
  parseVersion,
  pickUninstallSubcommand,
  uninstallPlan,
  versionOk,
} from '../bin/ultramod.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'bin', 'ultramod.mjs');
const NODE_DIR = dirname(process.execPath);
const POSIX = process.platform !== 'win32';

const STUB = [
  '#!/bin/sh',
  "printf '%s\\n' \"$*\" >> \"$STUB_LOG\"",
  'if [ "$1" = "--version" ]; then',
  "  printf '%s\\n' \"${STUB_VERSION:-2.1.292 (Claude Code)}\"",
  '  exit 0',
  'fi',
  'if [ "$1 $2 $3" = "plugin marketplace list" ]; then',
  "  printf '%s\\n' 'Configured marketplaces:' ''",
  '  if [ -n "$STUB_MARKETPLACE" ]; then',
  "    printf '%s\\n' \"  - $STUB_MARKETPLACE\" '    Source: GitHub (mertkayacs/ultramod)'",
  '  fi',
  '  exit 0',
  'fi',
  'if [ "$1 $2" = "plugin list" ]; then',
  "  printf '%s\\n' 'Installed plugins:' ''",
  '  if [ -n "$STUB_PLUGIN" ]; then',
  "    printf '%s\\n' \"  - $STUB_PLUGIN\" '    Version: 1.0.0' '    Scope: user' \"    Status: ${STUB_PLUGIN_STATUS:-enabled}\"",
  '  fi',
  '  exit 0',
  'fi',
  'if [ "$1 $2" = "plugin --help" ]; then',
  "  printf '%s\\n' 'Usage: claude plugin [options] [command]' '' 'Commands:' '  uninstall|remove [options] <plugin>  Uninstall an installed plugin' '  help [command]                       display help for command'",
  '  exit 0',
  'fi',
  'exit 0',
  '',
].join('\n');

let workDir;
let stubBin;
let homeDir;
let logSeq = 0;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ultramod-installer-'));
  stubBin = join(workDir, 'bin');
  homeDir = join(workDir, 'home');
  mkdirSync(stubBin, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  const stub = join(stubBin, 'claude');
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function stubEnv(extra = {}) {
  logSeq += 1;
  const log = join(workDir, `calls-${logSeq}.log`);
  return {
    log,
    env: {
      ...process.env,
      PATH: POSIX ? `${stubBin}${delimiter}${NODE_DIR}` : NODE_DIR,
      STUB_LOG: log,
      HOME: homeDir,
      USERPROFILE: homeDir,
      NO_COLOR: '1',
      ...extra,
    },
  };
}

function runCli(args, env) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readLog(log) {
  try {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const mutating = (line) =>
  /(?:^| )marketplace (?:add|update|remove)(?: |$)|(?:^| )plugin (?:install|uninstall|remove)(?: |$)/
    .test(line);

const lines = (text) => text.trimEnd().split('\n');

test('parseVersion reads x.y.z from claude --version output', () => {
  assert.equal(parseVersion('2.1.292 (Claude Code)'), '2.1.292');
  assert.equal(parseVersion('1.2.3'), '1.2.3');
  assert.equal(parseVersion('Claude Code v2.1.287'), '2.1.287');
  assert.equal(parseVersion('01.02.003'), '01.02.003');
  assert.equal(parseVersion('no digits here'), null);
  assert.equal(parseVersion('2.1'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(undefined), null);
  assert.equal(parseVersion(null), null);
});

test('compareVersions orders numeric triples', () => {
  assert.equal(compareVersions('2.1.287', '2.1.287'), 0);
  assert.ok(compareVersions('2.1.288', '2.1.287') > 0);
  assert.ok(compareVersions('2.1.286', '2.1.287') < 0);
  assert.ok(compareVersions('2.2.0', '2.1.999') > 0);
  assert.ok(compareVersions('10.0.0', '9.0.0') > 0);
  assert.ok(compareVersions('2.10.0', '2.9.0') > 0);
  assert.equal(compareVersions('2.1', '2.1.0'), 0);
  assert.ok(compareVersions('2.1', '2.2') < 0);
});

test('versionOk enforces the 2.1.287 floor', () => {
  assert.equal(MIN_CLAUDE_VERSION, '2.1.287');
  assert.ok(versionOk('2.1.287'));
  assert.ok(versionOk('2.1.288'));
  assert.ok(versionOk('2.1.292'));
  assert.ok(versionOk('3.0.0'));
  assert.ok(!versionOk('2.1.286'));
  assert.ok(!versionOk('2.1.0'));
  assert.ok(!versionOk('1.0.0'));
  assert.ok(!versionOk(null));
  assert.ok(!versionOk(''));
  assert.ok(!versionOk('not a version'));
  assert.ok(!versionOk('2.1.287-rc1'));
  assert.ok(!versionOk(undefined));
});

test('parseMarketplaceList keeps single-token names only', () => {
  const sample = [
    'Configured marketplaces:',
    '',
    '  \u276f anthropic-plugin-directory',
    '    Source: Built in (Anthropic Directory)',
    '',
    '  \u276f ultramod',
    '    Source: GitHub (mertkayacs/ultramod)',
    '',
    'From claude.ai:',
    '',
    '  \u276f (no CLI name) \u00b7 listed as "Anthropic Directory" (browse on claude.ai)',
    '',
  ].join('\n');
  assert.deepEqual(parseMarketplaceList(sample), ['anthropic-plugin-directory', 'ultramod']);
  assert.ok(parseMarketplaceList(sample).includes('ultramod'));
  assert.deepEqual(parseMarketplaceList('- claude-plugins-official\n  Source: GitHub (a/b)'), [
    'claude-plugins-official',
  ]);
  assert.deepEqual(parseMarketplaceList('Configured marketplaces:\n'), []);
  assert.deepEqual(parseMarketplaceList(''), []);
  assert.deepEqual(parseMarketplaceList(undefined), []);
  assert.ok(!parseMarketplaceList('Configured marketplaces:\n').includes('ultramod'));
});

test('parsePluginList reads ids and enabled state', () => {
  const sample = [
    'Installed plugins:',
    '',
    '  \u276f ultramod@ultramod',
    '    Version: 1.0.0',
    '    Scope: user',
    '    Status: \u2714 enabled',
    '',
    '  \u276f cloudflare@cloudflare',
    '    Version: 1.0.0',
    '    Scope: user',
    '    Status: \u2718 disabled',
    '',
    '  \u276f bare',
    '    Version: 2.0.0',
    '',
    '    Note: The packages it lists were not installed',
    '',
  ].join('\n');
  const entries = parsePluginList(sample);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], {
    id: 'ultramod@ultramod',
    name: 'ultramod',
    marketplace: 'ultramod',
    enabled: true,
  });
  assert.equal(entries[1].id, 'cloudflare@cloudflare');
  assert.equal(entries[1].enabled, false);
  assert.equal(entries[2].id, 'bare');
  assert.equal(entries[2].marketplace, null);
  assert.equal(entries[2].enabled, false);
  assert.ok(findPlugin(entries, 'ultramod@ultramod'));
  assert.equal(findPlugin(entries, 'ultramod@ultramod').enabled, true);
  assert.equal(findPlugin(entries, 'missing@ultramod'), null);
  assert.deepEqual(parsePluginList('Installed plugins:\n'), []);
  assert.deepEqual(parsePluginList(''), []);
});

test('pickUninstallSubcommand follows claude plugin --help', () => {
  const help = [
    'Usage: claude plugin|plugins [options] [command]',
    '',
    'Commands:',
    '  list [options]                       List installed plugins',
    '  uninstall|remove [options] <plugin>  Uninstall an installed plugin',
    '  help [command]                       display help for command',
    '',
  ].join('\n');
  assert.equal(pickUninstallSubcommand(help), 'uninstall');
  assert.equal(pickUninstallSubcommand('Commands:\n  remove <plugin>   Remove a plugin\n'), 'remove');
  assert.equal(pickUninstallSubcommand('  uninstall <plugin>\n'), 'uninstall');
  assert.equal(pickUninstallSubcommand(''), 'uninstall');
  assert.equal(pickUninstallSubcommand(undefined), 'uninstall');
});

test('installPlan adds or updates the marketplace', () => {
  assert.deepEqual(installPlan('claude', false).map(formatCommand), [
    'claude plugin marketplace add mertkayacs/ultramod',
    'claude plugin install ultramod@ultramod',
  ]);
  assert.deepEqual(installPlan('claude', true).map(formatCommand), [
    'claude plugin marketplace update ultramod',
    'claude plugin install ultramod@ultramod',
  ]);
});

test('uninstallPlan drops the marketplace removal with --keep-marketplace', () => {
  assert.deepEqual(uninstallPlan('claude', { uninstallSubcommand: 'uninstall' }).map(formatCommand), [
    'claude plugin uninstall ultramod@ultramod',
    'claude plugin marketplace remove ultramod',
  ]);
  assert.deepEqual(
    uninstallPlan('claude', { uninstallSubcommand: 'remove', keepMarketplace: true }).map(formatCommand),
    ['claude plugin remove ultramod@ultramod'],
  );
});

test('help text is under 15 lines and lists every command', () => {
  const text = helpText();
  assert.ok(lines(text).length < 15, `${lines(text).length} lines`);
  assert.match(text, /Usage: npx ultramod/);
  for (const word of ['install', 'uninstall', 'doctor', 'help', '--dry-run', '-v', '-h']) {
    assert.ok(text.includes(word), `missing ${word}`);
  }
});

test('cli --help, -h and help print usage and exit 0', () => {
  for (const flag of ['--help', '-h', 'help']) {
    const result = runCli([flag]);
    assert.equal(result.status, 0, flag);
    assert.ok(lines(result.stdout).length < 15, flag);
    assert.match(result.stdout, /Usage: npx ultramod/);
    assert.equal(result.stderr, '');
  }
});

test('cli --version and -v print the package version', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const flag of ['--version', '-v']) {
    const result = runCli([flag]);
    assert.equal(result.status, 0, flag);
    assert.equal(result.stdout.trim(), pkg.version);
  }
});

test('cli rejects unknown commands and options', () => {
  const command = runCli(['frobnicate']);
  assert.equal(command.status, 1);
  assert.match(command.stderr, /Unknown command: frobnicate/);
  const option = runCli(['--frobnicate']);
  assert.equal(option.status, 1);
  assert.match(option.stderr, /Unknown option: --frobnicate/);
});

test('invocation quotes a .cmd path that contains spaces on Windows', () => {
  const { file, args, options } = invocation(
    'C:\\Program Files\\nodejs\\claude.cmd',
    ['plugin', 'list'],
    'win32',
  );
  assert.equal(file, '"C:\\Program Files\\nodejs\\claude.cmd"');
  assert.deepEqual(args, ['"plugin"', '"list"']);
  assert.deepEqual(options, { shell: true });
});

test('invocation leaves POSIX commands alone', () => {
  const { file, args, options } = invocation('claude', ['--version'], 'linux');
  assert.equal(file, 'claude');
  assert.deepEqual(args, ['--version']);
  assert.deepEqual(options, { shell: false });
});

test('install --dry-run without claude prints a fresh plan and exits 0', () => {
  const { env, log } = stubEnv();
  const result = runCli(['install', '--dry-run'], { ...env, PATH: NODE_DIR });
  assert.equal(result.status, 0);
  assert.deepEqual(lines(result.stdout), [
    'claude not found on PATH; showing a fresh install plan.',
    'Would run:',
    'claude plugin marketplace add mertkayacs/ultramod',
    'claude plugin install ultramod@ultramod',
  ]);
  assert.deepEqual(readLog(log), []);
});

test('install --dry-run updates an existing marketplace and runs nothing', { skip: !POSIX }, () => {
  const { env, log } = stubEnv({ STUB_MARKETPLACE: 'ultramod' });
  const result = runCli(['install', '--dry-run'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    'Would run:',
    'claude plugin marketplace update ultramod',
    'claude plugin install ultramod@ultramod',
  ]);
  const calls = readLog(log);
  assert.ok(calls.length > 0, 'the stub should have been probed');
  assert.deepEqual(calls.filter(mutating), [], 'dry-run must not mutate');
});

test('install --dry-run adds the marketplace when it is absent', { skip: !POSIX }, () => {
  const { env, log } = stubEnv({ STUB_MARKETPLACE: '' });
  const result = runCli(['install', '--dry-run'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    'Would run:',
    'claude plugin marketplace add mertkayacs/ultramod',
    'claude plugin install ultramod@ultramod',
  ]);
  assert.deepEqual(readLog(log).filter(mutating), []);
});

test('install refuses a claude older than the mods floor', { skip: !POSIX }, () => {
  const { env, log } = stubEnv({ STUB_VERSION: '2.1.286 (Claude Code)' });
  const result = runCli(['install'], env);
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    'Ultra Mod needs Claude Code 2.1.287 or later. Run: claude update',
  );
  assert.deepEqual(readLog(log).filter(mutating), []);
});

test('install fails with setup instructions when claude is missing', () => {
  const { env } = stubEnv();
  const result = runCli(['install'], { ...env, PATH: NODE_DIR });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Claude Code not found on PATH/);
  assert.match(result.stderr, /https:\/\/code\.claude\.com\/docs\/en\/setup/);
});

test('install runs the planned commands and prints the three lines', { skip: !POSIX }, () => {
  const { env, log } = stubEnv({ STUB_MARKETPLACE: '' });
  const result = runCli(['install'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('claude plugin marketplace add mertkayacs/ultramod'));
  assert.ok(result.stdout.includes('claude plugin install ultramod@ultramod'));
  assert.deepEqual(readLog(log), [
    '--version',
    'plugin marketplace list',
    'plugin marketplace add mertkayacs/ultramod',
    'plugin install ultramod@ultramod',
  ]);
  assert.deepEqual(lines(result.stdout).slice(-3), [
    'Installed ultramod@ultramod.',
    'Open Claude Code and type /ultra.',
    'Switch sets with /ultra set strict (or flow, marathon, quiet).',
  ]);
});

test('uninstall --dry-run prints both commands and runs nothing', { skip: !POSIX }, () => {
  const { env, log } = stubEnv();
  const result = runCli(['uninstall', '--dry-run'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    'Would run:',
    'claude plugin uninstall ultramod@ultramod',
    'claude plugin marketplace remove ultramod',
  ]);
  assert.deepEqual(readLog(log).filter(mutating), []);
});

test('uninstall --dry-run --keep-marketplace keeps the marketplace', { skip: !POSIX }, () => {
  const { env, log } = stubEnv();
  const result = runCli(['uninstall', '--dry-run', '--keep-marketplace'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    'Would run:',
    'claude plugin uninstall ultramod@ultramod',
  ]);
  assert.deepEqual(readLog(log).filter(mutating), []);
});

test('uninstall runs the planned commands and reports what it did', { skip: !POSIX }, () => {
  const { env, log } = stubEnv();
  const result = runCli(['uninstall'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readLog(log), [
    'plugin --help',
    'plugin uninstall ultramod@ultramod',
    'plugin marketplace remove ultramod',
  ]);
  assert.deepEqual(lines(result.stdout).slice(-2), [
    'Removed ultramod@ultramod.',
    'Removed the ultramod marketplace.',
  ]);
});

test('doctor reports a healthy install and exits 0', { skip: !POSIX }, () => {
  const { env } = stubEnv({ STUB_MARKETPLACE: 'ultramod', STUB_PLUGIN: 'ultramod@ultramod' });
  const result = runCli(['doctor'], env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^Node v\d+/m);
  assert.match(result.stdout, /^claude: \S+ 2\.1\.292 OK$/m);
  assert.match(result.stdout, /^marketplace ultramod: present$/m);
  assert.match(result.stdout, /^plugin ultramod@ultramod: installed, enabled$/m);
  assert.match(result.stdout, /^settings disableAllHooks: not set$/m);
  assert.match(result.stdout, /all checks passed/);
});

test('doctor reports missing pieces and exits 1', { skip: !POSIX }, () => {
  const { env } = stubEnv({ STUB_MARKETPLACE: '', STUB_PLUGIN: '' });
  const result = runCli(['doctor'], env);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^marketplace ultramod: missing$/m);
  assert.match(result.stdout, /^plugin ultramod@ultramod: not installed$/m);
  assert.match(result.stdout, /1 problem\(s\)|2 problem\(s\)/);
});

test('doctor flags an old claude', { skip: !POSIX }, () => {
  const { env } = stubEnv({
    STUB_VERSION: '2.0.0 (Claude Code)',
    STUB_MARKETPLACE: 'ultramod',
    STUB_PLUGIN: 'ultramod@ultramod',
  });
  const result = runCli(['doctor'], env);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /2\.0\.0 too old \(need 2\.1\.287\+\)/);
});

test('the installer entry point is guarded against imports', () => {
  const source = readFileSync(CLI, 'utf8');
  assert.match(source, /isEntryPoint\(\)/);
  assert.equal(typeof installPlan, 'function');
});
