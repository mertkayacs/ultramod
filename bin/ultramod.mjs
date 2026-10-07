#!/usr/bin/env node
// Ultra Mod installer: `npx ultramod`.
// Zero dependencies, Node 18+, Linux, macOS and Windows.
// Every external command is spawned as an argv array; no shell string is built.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_CLAUDE_VERSION = '2.1.287';
export const MIN_NODE_MAJOR = 18;
export const MARKETPLACE_NAME = 'ultramod';
export const MARKETPLACE_SOURCE = 'mertkayacs/ultramod';
export const PLUGIN_ID = 'ultramod@ultramod';
export const SETUP_URL = 'https://code.claude.com/docs/en/setup';

const BULLET = /^(?:\u276f|-|\*)\s+/;
const BULLET_LINE = /^(?:\u276f|-|\*)\s+(\S+)\s*$/;

export function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ''));
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function compareVersions(a, b) {
  const left = String(a ?? '').split('.');
  const right = String(b ?? '').split('.');
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = Number.parseInt(left[i], 10) || 0;
    const r = Number.parseInt(right[i], 10) || 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function versionOk(version, min = MIN_CLAUDE_VERSION) {
  if (!version || !/^\d+\.\d+\.\d+$/.test(String(version))) return false;
  return compareVersions(version, min) >= 0;
}

// Only a lone token after the bullet counts as a name. The claude.ai section
// puts a whole sentence after its bullet and is skipped on purpose.
export function parseMarketplaceList(text) {
  const names = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!BULLET.test(line)) continue;
    const token = line.replace(BULLET, '').trim();
    if (token && !/\s/.test(token)) names.push(token);
  }
  return names;
}

export function parsePluginList(text) {
  const entries = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = BULLET_LINE.exec(line);
    if (head) {
      const id = head[1];
      const at = id.lastIndexOf('@');
      entries.push({
        id,
        name: at === -1 ? id : id.slice(0, at),
        marketplace: at === -1 ? null : id.slice(at + 1),
        enabled: false,
      });
      continue;
    }
    const status = /^Status:\s*(.*)$/.exec(line);
    if (status && entries.length > 0) {
      const current = entries[entries.length - 1];
      current.enabled = /enabled/i.test(status[1]) && !/disabled/i.test(status[1]);
    }
  }
  return entries;
}

export function findPlugin(entries, id) {
  return entries.find((entry) => entry.id === id) ?? null;
}

export function pickUninstallSubcommand(helpText) {
  for (const raw of String(helpText ?? '').split(/\r?\n/)) {
    const head = /^([a-z]+(?:\|[a-z]+)*)\s+\S/.exec(raw.trim());
    if (!head) continue;
    const names = head[1].split('|');
    if (names.includes('uninstall')) return 'uninstall';
    if (names.includes('remove')) return 'remove';
  }
  return 'uninstall';
}

export function formatCommand(argv) {
  return argv.join(' ');
}

export function installPlan(claude, marketplacePresent) {
  return [
    [
      claude,
      'plugin',
      'marketplace',
      marketplacePresent ? 'update' : 'add',
      marketplacePresent ? MARKETPLACE_NAME : MARKETPLACE_SOURCE,
    ],
    [claude, 'plugin', 'install', PLUGIN_ID],
  ];
}

export function uninstallPlan(claude, options = {}) {
  const subcommand = options.uninstallSubcommand || 'uninstall';
  const plan = [[claude, 'plugin', subcommand, PLUGIN_ID]];
  if (!options.keepMarketplace) {
    plan.push([claude, 'plugin', 'marketplace', 'remove', MARKETPLACE_NAME]);
  }
  return plan;
}

export function helpText() {
  return [
    'Ultra Mod installer',
    'Usage: npx ultramod [command] [options]',
    '',
    'Commands:',
    '  install       Add the marketplace and install the plugin (default)',
    '  uninstall     Remove the plugin (--keep-marketplace keeps the marketplace)',
    '  doctor        Check Node, claude, the marketplace, the plugin and settings',
    '  help          Show this help',
    '',
    'Options:',
    '  --dry-run     Print the commands without running them',
    '  -v, --version Print the ultramod version',
    '  -h, --help    Show this help',
    '',
  ].join('\n');
}

function paint(text, code) {
  const enabled = !('NO_COLOR' in process.env) && Boolean(process.stdout.isTTY);
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function out(line = '') {
  process.stdout.write(`${line}\n`);
}

function err(line) {
  process.stderr.write(`${line}\n`);
}

export function invocation(cmd, args, platform = process.platform) {
  // A .cmd/.bat shim is a batch file and Node refuses to exec one directly
  // (CVE-2024-27980), so on Windows only cmd.exe may run it. The shell never
  // receives a string we assembled: the argv stays an array of our own fixed
  // tokens, each wrapped in double quotes, so there is nothing to interpolate.
  // The shim path is quoted too, or an install under "Program Files" hands
  // cmd.exe two words where it expects the program.
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
    return { file: `"${cmd}"`, args: args.map((arg) => `"${arg}"`), options: { shell: true } };
  }
  return { file: cmd, args, options: { shell: false } };
}

function capture(cmd, args) {
  const { file, args: argv, options } = invocation(cmd, args);
  let result;
  try {
    result = spawnSync(file, argv, { ...options, encoding: 'utf8', windowsHide: true });
  } catch (error) {
    return { ok: false, status: null, stdout: '', stderr: String(error?.message ?? error) };
  }
  if (result.error) {
    return { ok: false, status: null, stdout: '', stderr: String(result.error.message ?? result.error) };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function stream(cmd, args) {
  const { file, args: argv, options } = invocation(cmd, args);
  let result;
  try {
    result = spawnSync(file, argv, { ...options, stdio: 'inherit', windowsHide: true });
  } catch (error) {
    return { ok: false, status: null, message: String(error?.message ?? error) };
  }
  if (result.error) {
    return { ok: false, status: null, message: String(result.error.message ?? result.error) };
  }
  return { ok: result.status === 0, status: result.status };
}

function runnable(full, platform) {
  try {
    if (!statSync(full).isFile()) return false;
    if (platform !== 'win32') accessSync(full, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(name, env, platform) {
  const dirs = String(env.PATH || env.Path || '').split(delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const names = /\.(exe|cmd|bat|com)$/i.test(name)
    ? [name]
    : [...new Set([name, ...extensions.map((ext) => name + ext)])];
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = join(dir, candidate);
      if (runnable(full, platform)) return full;
    }
  }
  return null;
}

function findClaude(env = process.env, platform = process.platform) {
  const names = platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
  for (const name of names) {
    const path = findOnPath(name, env, platform);
    if (path) return { name, path };
  }
  return null;
}

function printPlan(plan, options = {}) {
  if (options.dryRun) out('Would run:');
  for (const argv of plan) out(formatCommand(argv));
}

function runPlan(plan) {
  for (const argv of plan) {
    const result = stream(argv[0], argv.slice(1));
    if (!result.ok) {
      const detail = result.status === null ? result.message : `exit ${result.status}`;
      err(`Command failed (${detail}): ${formatCommand(argv)}`);
      return false;
    }
  }
  return true;
}

function packageVersion() {
  try {
    const file = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function missingClaude() {
  err('Claude Code not found on PATH.');
  err(`Install it: ${SETUP_URL}`);
}

function cmdInstall({ dryRun }) {
  const claude = findClaude();
  if (!claude) {
    if (dryRun) {
      out('claude not found on PATH; showing a fresh install plan.');
      printPlan(installPlan('claude', false), { dryRun });
      return 0;
    }
    missingClaude();
    return 1;
  }

  if (!dryRun) {
    const version = parseVersion(capture(claude.name, ['--version']).stdout);
    if (!versionOk(version)) {
      if (version) {
        err(`Ultra Mod needs Claude Code ${MIN_CLAUDE_VERSION} or later. Run: claude update`);
      } else {
        err('Could not read the Claude Code version. Run: claude --version');
      }
      return 1;
    }
  }

  const marketplaces = parseMarketplaceList(
    capture(claude.name, ['plugin', 'marketplace', 'list']).stdout,
  );
  const plan = installPlan(claude.name, marketplaces.includes(MARKETPLACE_NAME));
  printPlan(plan, { dryRun });
  if (dryRun) return 0;

  if (!runPlan(plan)) return 1;
  out(`Installed ${PLUGIN_ID}.`);
  out('Open Claude Code and type /ultra.');
  out('Switch sets with /ultra set strict (or flow, marathon, quiet).');
  return 0;
}

function cmdUninstall({ dryRun, keepMarketplace }) {
  const claude = findClaude();
  if (!claude) {
    if (dryRun) {
      out('claude not found on PATH; showing the uninstall plan.');
      printPlan(uninstallPlan('claude', { keepMarketplace, uninstallSubcommand: 'uninstall' }), { dryRun });
      return 0;
    }
    missingClaude();
    return 1;
  }

  const help = capture(claude.name, ['plugin', '--help']);
  const plan = uninstallPlan(claude.name, {
    keepMarketplace,
    uninstallSubcommand: pickUninstallSubcommand(help.stdout),
  });
  printPlan(plan, { dryRun });
  if (dryRun) return 0;

  if (!runPlan(plan)) return 1;
  out(`Removed ${PLUGIN_ID}.`);
  out(keepMarketplace
    ? `Kept the ${MARKETPLACE_NAME} marketplace.`
    : `Removed the ${MARKETPLACE_NAME} marketplace.`);
  return 0;
}

function cmdDoctor() {
  const problems = [];
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10) || 0;
  if (nodeMajor >= MIN_NODE_MAJOR) {
    out(`Node ${process.version} OK`);
  } else {
    out(`Node ${process.version} too old (need ${MIN_NODE_MAJOR}+)`);
    problems.push('node');
  }

  const claude = findClaude();
  if (!claude) {
    out(`claude: not found on PATH (install: ${SETUP_URL})`);
    problems.push('claude');
  } else {
    const version = parseVersion(capture(claude.name, ['--version']).stdout);
    if (!version) {
      out(`claude: ${claude.path} version unknown`);
      problems.push('claude');
    } else if (!versionOk(version)) {
      out(`claude: ${claude.path} ${version} too old (need ${MIN_CLAUDE_VERSION}+)`);
      problems.push('claude');
    } else {
      out(`claude: ${claude.path} ${version} OK`);
    }
  }

  if (claude) {
    const marketplaces = parseMarketplaceList(
      capture(claude.name, ['plugin', 'marketplace', 'list']).stdout,
    );
    if (marketplaces.includes(MARKETPLACE_NAME)) {
      out(`marketplace ${MARKETPLACE_NAME}: present`);
    } else {
      out(`marketplace ${MARKETPLACE_NAME}: missing`);
      problems.push('marketplace');
    }

    const plugin = findPlugin(
      parsePluginList(capture(claude.name, ['plugin', 'list']).stdout),
      PLUGIN_ID,
    );
    if (!plugin) {
      out(`plugin ${PLUGIN_ID}: not installed`);
      problems.push('plugin');
    } else if (!plugin.enabled) {
      out(`plugin ${PLUGIN_ID}: installed, disabled`);
      problems.push('plugin');
    } else {
      out(`plugin ${PLUGIN_ID}: installed, enabled`);
    }
  } else {
    out(`marketplace ${MARKETPLACE_NAME}: unknown (claude not found)`);
    out(`plugin ${PLUGIN_ID}: unknown (claude not found)`);
  }

  const settingsPath = join(homedir(), '.claude', 'settings.json');
  let hooksOff = false;
  let unreadable = false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    hooksOff = Boolean(settings?.disableAllHooks);
  } catch (error) {
    if (error?.code !== 'ENOENT') unreadable = true;
  }
  if (unreadable) {
    out(`settings ${settingsPath}: unreadable`);
    problems.push('settings');
  } else if (hooksOff) {
    out('settings disableAllHooks: set (hooks are off)');
    problems.push('settings');
  } else {
    out('settings disableAllHooks: not set');
  }

  if (problems.length > 0) {
    out(`doctor: ${problems.length} problem(s)`);
    return 1;
  }
  out(`doctor: ${paint('all checks passed', 32)}`);
  return 0;
}

function parseArgs(argv) {
  const flags = { dryRun: false, keepMarketplace: false, help: false, version: false };
  const positionals = [];
  const unknown = [];
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--keep-marketplace') flags.keepMarketplace = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' || arg === '-v') flags.version = true;
    else if (arg.startsWith('-') && arg !== '-') unknown.push(arg);
    else positionals.push(arg);
  }
  return { flags, positionals, unknown };
}

function main(argv = process.argv.slice(2)) {
  const { flags, positionals, unknown } = parseArgs(argv);
  if (unknown.length > 0) {
    err(`Unknown option: ${unknown[0]}`);
    err('Run: npx ultramod --help');
    return 1;
  }
  if (flags.help || positionals[0] === 'help') {
    out(helpText().trimEnd());
    return 0;
  }
  if (flags.version) {
    out(packageVersion());
    return 0;
  }
  const command = positionals[0] ?? 'install';
  if (positionals.length > 1) {
    err(`Unexpected argument: ${positionals[1]}`);
    err('Run: npx ultramod --help');
    return 1;
  }
  if (command === 'install') return cmdInstall(flags);
  if (command === 'uninstall') return cmdUninstall(flags);
  if (command === 'doctor') return cmdDoctor();
  err(`Unknown command: ${command}`);
  err('Run: npx ultramod --help');
  return 1;
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main();
}
