// Risk table from SPEC 4.3. Precision beats recall: every rule here has
// look-alike tests proving what it must ignore.
import { splitCommand, splitPipelines, commandArgv, tokens, baseName, normalize } from './shell'

export type RiskKind = 'git' | 'rm' | 'sql' | 'infra' | 'remote-exec' | 'disk' | 'publish'

export interface RiskHit {
  id: string
  reason: string
  kind: RiskKind
  snapshot: boolean
}

export interface ClassifyOptions {
  strict?: boolean
}

const RM_SAFE_ROOTS = [
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'target',
  '__pycache__',
  '.cache',
]

// Is one rm target safe (a build artifact dir, or inside /tmp)?
function rmTargetSafe(raw: string): boolean {
  let t = raw
  if (t === '') return true
  while (t.length > 1 && t.endsWith('/')) t = t.slice(0, -1)
  if (t === '~' || t === '.' || t === '..' || t === '*' || t === '$HOME' || t === '${HOME}') return false
  if (t.startsWith('$')) return false
  if (t.startsWith('~/')) t = t.slice(2)
  while (t.startsWith('./') || t.startsWith('../')) t = t.slice(t.indexOf('/', 1) + 1)
  if (t === '/' || t === '') return false
  // Resolve . and .. first: /tmp/../etc and dist/../private are not what
  // their first component says.
  const resolved = resolvePath(t)
  if (resolved === null) return false
  if (resolved.startsWith('/tmp/')) return true
  if (resolved.startsWith('/')) return false
  const first = resolved.split('/')[0] ?? ''
  return RM_SAFE_ROOTS.indexOf(first) !== -1
}

// Collapse . and .. segments. A relative path that climbs out of its start
// (or ends up at the start itself) has no safe name, so it returns null.
function resolvePath(path: string): string | null {
  const absolute = path.startsWith('/')
  const resolved: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (resolved.length > 0) resolved.pop()
      else if (!absolute) return null
      continue
    }
    resolved.push(part)
  }
  if (!absolute && resolved.length === 0) return null
  return absolute ? '/' + resolved.join('/') : resolved.join('/')
}

function hit(id: string, reason: string, kind: RiskKind, snapshot: boolean): RiskHit {
  return { id, reason, kind, snapshot }
}

// Git subcommand: skip global flags (-C path, -c conf, ...) and return
// [subcommand, args...].
function gitParts(words: string[]): string[] {
  const valueFlags = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']
  let i = 1
  while (i < words.length) {
    const w = words[i] ?? ''
    if (w === '--') break
    if (valueFlags.indexOf(w) !== -1) {
      i += 2
      continue
    }
    if (w.startsWith('-')) {
      i++
      continue
    }
    break
  }
  return words.slice(i)
}

// Does a refspec name a protected branch (main or master)?
function isProtectedRef(ref: string): boolean {
  let r = ref
  if (r.startsWith('+')) r = r.slice(1)
  if (r.startsWith('refs/heads/')) r = r.slice(11)
  const colon = r.indexOf(':')
  if (colon !== -1) r = r.slice(colon + 1)
  return r === 'main' || r === 'master'
}

// Global flags that take a value before the verb, so the verb is not read as
// a flag's value: kubectl -n prod delete ..., terraform -chdir dir destroy,
// docker -H host system prune. Both the separate-value and the =value forms.
const VERB_VALUE_FLAGS: Record<string, readonly string[]> = {
  docker: ['-H', '--host', '-c', '--context', '--config', '-l', '--log-level', '--tlscacert', '--tlscert', '--tlskey'],
  kubectl: [
    '-n', '--namespace', '--context', '-c', '--cluster', '--container', '--kubeconfig',
    '-s', '--server', '--token', '--user', '--username', '--password', '--as', '--as-group', '--as-uid',
    '--certificate-authority', '--client-certificate', '--client-key', '--cache-dir', '--request-timeout',
    '--tls-server-name', '--profile', '--profile-output', '-v', '--v', '--vmodule',
  ],
  terraform: ['-chdir'],
  tofu: ['-chdir'],
}

// The args from the verb on: skip global flags (and the value each known
// value flag carries) and stop at the first word that is not a flag.
function argsFromVerb(head: string, args: string[]): string[] {
  const valueFlags = VERB_VALUE_FLAGS[head]
  let i = 0
  while (i < args.length) {
    const a = args[i] ?? ''
    if (a.startsWith('-') && a.length > 1) {
      i += valueFlags !== undefined && !a.includes('=') && valueFlags.indexOf(a) !== -1 ? 2 : 1
      continue
    }
    break
  }
  return args.slice(i)
}

const SQL_CARRIERS = ['psql', 'mysql', 'sqlite3']

const SQL_PATTERNS: { id: string; re: RegExp; reason: string }[] = [
  { id: 'sql-drop', re: /\bdrop\s+(database|schema|table)\b/i, reason: 'drops a database object' },
  { id: 'sql-truncate', re: /\btruncate\s+(table\s+)?[A-Za-z_"'`.[\]]/i, reason: 'empties a table' },
]

const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c)

// Does the statement that starts at from carry a WHERE in code position?
// Comments (/* */, --, #) and quoted text cannot supply the condition.
function hasWhere(text: string, from: number): boolean {
  const n = text.length
  let i = from
  while (i < n) {
    const c = text.charAt(i)
    if (c === ';') return false
    if (c === "'" || c === '"' || c === '`') {
      const j = text.indexOf(c, i + 1)
      if (j === -1) return false
      i = j + 1
      continue
    }
    if (c === '/' && text.charAt(i + 1) === '*') {
      const j = text.indexOf('*/', i + 2)
      if (j === -1) return false
      i = j + 2
      continue
    }
    if ((c === '-' && text.charAt(i + 1) === '-') || c === '#') {
      const j = text.indexOf('\n', i)
      if (j === -1) return false
      i = j + 1
      continue
    }
    if ((c === 'w' || c === 'W') && text.slice(i, i + 5).toLowerCase() === 'where') {
      if (!isWordChar(text.charAt(i - 1)) && !isWordChar(text.charAt(i + 5))) return true
    }
    i++
  }
  return false
}

// Check SQL statements inside a carrier command. delete from without where
// needs statement-level inspection.
function sqlCheck(text: string): RiskHit | null {
  for (const p of SQL_PATTERNS) {
    if (p.re.test(text)) return hit(p.id, p.reason, 'sql', false)
  }
  const re = /\bdelete\s+from\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!hasWhere(text, m.index + m[0].length)) {
      return hit('sql-delete-all', 'deletes every row of a table', 'sql', false)
    }
  }
  return null
}

// Commands that run another command somewhere else (a container, a pod, a
// host). A SQL tool named behind them is a carrier too.
const REMOTE_HEADS = ['docker', 'docker-compose', 'podman', 'podman-compose', 'nerdctl', 'kubectl', 'oc', 'ssh', 'lxc', 'incus']

function carrierBehindWrapper(head: string, args: string[]): boolean {
  if (REMOTE_HEADS.indexOf(head) === -1) return false
  for (const a of args) {
    if (SQL_CARRIERS.indexOf(baseName(a)) !== -1) return true
    // a quoted remote command line: ssh host "psql -c '...'"
    if (/\s/.test(a)) {
      for (const inner of splitCommand(a)) {
        const w = commandArgv(inner)
        if (w.length > 0 && SQL_CARRIERS.indexOf(baseName(w[0] ?? '')) !== -1) return true
      }
    }
  }
  return false
}

function checkSimple(simple: string, strict: boolean): RiskHit | null {
  const words = commandArgv(simple)
  if (words.length === 0) return null
  const head = baseName(words[0] ?? '')
  const args = words.slice(1)

  if (head === 'rm') {
    let recursive = false
    let afterDashDash = false
    const targets: string[] = []
    for (const a of args) {
      if (a === '--') {
        afterDashDash = true
        continue
      }
      if (!afterDashDash && a.startsWith('-') && a.length > 1) {
        if (a === '--recursive') recursive = true
        else if (a.startsWith('--')) {
          // other long flags take no interest here
        } else {
          for (const ch of a.slice(1)) {
            if (ch === 'r' || ch === 'R') recursive = true
          }
        }
        continue
      }
      targets.push(a)
    }
    const real = targets.filter((t) => t !== '' && t !== '&')
    if (recursive && real.length > 0) {
      for (const t of real) {
        if (!rmTargetSafe(t)) {
          return hit('rm-recursive', `recursively deletes ${t}`, 'rm', true)
        }
      }
    }
    return null
  }

  if (head === 'git') {
    const sub = gitParts(words)
    const cmd = sub[0] ?? ''
    const rest = sub.slice(1)
    if (cmd === 'reset') {
      if (rest.indexOf('--hard') !== -1) {
        return hit('git-reset-hard', 'discards uncommitted changes', 'git', true)
      }
      return null
    }
    if (cmd === 'clean') {
      const hasF = rest.some((a) => a === '-f' || a === '--force' || /^-[a-zA-Z]*f/.test(a))
      const dryRun = rest.some((a) => a === '-n' || a === '--dry-run' || /^-[a-zA-Z]*n/.test(a))
      if (hasF && !dryRun) {
        return hit('git-clean', 'deletes untracked files', 'git', true)
      }
      return null
    }
    if (cmd === 'checkout' || cmd === 'restore') {
      const paths = rest.filter((a) => a !== '--' && !a.startsWith('-'))
      if (paths.indexOf('.') !== -1) {
        const id = cmd === 'checkout' ? 'git-checkout-discard' : 'git-restore-discard'
        return hit(id, 'discards changes in the whole tree', 'git', true)
      }
      return null
    }
    if (cmd === 'push') {
      const flags = rest.filter((a) => a.startsWith('-'))
      const refs = rest.filter((a) => !a.startsWith('-'))
      const force = flags.some((f) => f === '-f' || f === '--force')
      if (force) {
        return hit('git-push-force', 'overwrites remote history', 'git', false)
      }
      if (refs.some((r) => r.startsWith('+'))) {
        return hit('git-push-force', 'force pushes a refspec', 'git', false)
      }
      if (strict) {
        const hasLease = flags.some((f) => f === '--force-with-lease' || f.startsWith('--force-with-lease='))
        if (hasLease) {
          return hit('git-push-force-with-lease', 'force pushes with lease', 'git', false)
        }
        if (refs.length >= 2 && refs.slice(1).some(isProtectedRef)) {
          return hit('git-push-protected', 'pushes to main or master', 'git', false)
        }
      }
      return null
    }
    if (cmd === 'branch') {
      // -D, or a delete and a force given together in any spelling:
      // -d -f, -df, -fd, --delete -f, -d --force.
      let del = false
      let force = false
      let forceDelete = false
      for (const a of rest) {
        if (a === '--') break
        if (a === '--delete') del = true
        else if (a === '--force') force = true
        else if (a.startsWith('-') && !a.startsWith('--') && a.length > 1) {
          for (const ch of a.slice(1)) {
            if (ch === 'D') forceDelete = true
            else if (ch === 'd') del = true
            else if (ch === 'f') force = true
          }
        }
      }
      if (forceDelete || (del && force)) {
        return hit('git-branch-force-delete', 'force deletes a branch', 'git', false)
      }
      return null
    }
    if (cmd === 'stash' && (rest[0] === 'drop' || rest[0] === 'clear')) {
      return hit('git-stash-drop', 'deletes stashed work', 'git', true)
    }
    if (cmd === 'filter-branch' || cmd === 'filter-repo') {
      return hit('git-history-rewrite', 'rewrites git history', 'git', false)
    }
    return null
  }

  // SQL inside carriers and heredocs. An echo or comment is never a carrier,
  // so words inside them never reach these patterns.
  if (SQL_CARRIERS.indexOf(head) !== -1) {
    const h = sqlCheck(simple)
    if (h !== null) return h
  } else if (
    (/<<-?\s*['"]?[A-Za-z0-9_]/.test(simple) && new RegExp('\\b(' + SQL_CARRIERS.join('|') + ')\\b').test(simple)) ||
    carrierBehindWrapper(head, args)
  ) {
    // A SQL tool that is not the head word (docker exec, kubectl exec, ssh
    // and friends), fed by a heredoc or by its own -c / -e argument. The
    // body stays attached to this command, so scan it all.
    const h = sqlCheck(simple)
    if (h !== null) return h
  }

  if (head === 'docker') {
    const sub = argsFromVerb(head, args)
    const s0 = sub[0] ?? ''
    const s1 = sub[1] ?? ''
    if (s0 === 'system' && s1 === 'prune') {
      return hit('docker-prune', 'prunes docker objects', 'infra', false)
    }
    if (s0 === 'volume' && (s1 === 'rm' || s1 === 'prune')) {
      return hit('docker-volume-rm', 'deletes docker volumes', 'infra', false)
    }
    if ((s0 === 'image' || s0 === 'container' || s0 === 'builder' || s0 === 'network') && s1 === 'prune') {
      return hit('docker-prune', 'prunes docker objects', 'infra', false)
    }
    return null
  }

  if (head === 'kubectl') {
    if (argsFromVerb(head, args)[0] === 'delete') {
      return hit('kubectl-delete', 'deletes a cluster object', 'infra', false)
    }
    return null
  }

  if (head === 'terraform' || head === 'tofu') {
    if (argsFromVerb(head, args)[0] === 'destroy') {
      return hit('terraform-destroy', 'destroys infrastructure', 'infra', false)
    }
    return null
  }

  if (head === 'chmod') {
    const hasRecursive = args.some((a) => a === '-R' || a === '--recursive' || /^-[a-zA-Z]*R/.test(a))
    const has777 = args.some((a) => a === '777' || a === '0777')
    if (hasRecursive && has777) {
      return hit('chmod-777-recursive', 'opens everything to all users', 'disk', false)
    }
    if (hasRecursive) {
      for (const a of args) {
        if (a === '777' || a === '0777' || a === '-R' || a === '--recursive' || /^-[a-zA-Z]*R$/.test(a)) continue
        if (isWorldWritableSymbolic(a)) {
          return hit('chmod-777-recursive', 'opens everything to all users', 'disk', false)
        }
      }
    }
    return null
  }

function isWorldWritableSymbolic(mode: string): boolean {
  const perms = mode.split(',')
  for (const p of perms) {
    if (/^[augo]*\+.*w/.test(p)) {
      const who = p.match(/^([augo]*)/)?.[1] ?? 'a'
      if (who === '' || who.includes('a') || who.includes('o')) {
        return true
      }
    }
  }
  return false
}

  if (head.startsWith('mkfs')) {
    return hit('mkfs', 'formats a filesystem', 'disk', false)
  }

  if (head === 'dd') {
    const of = args.find((a) => a.startsWith('of='))
    if (of !== undefined) {
      const dev = of.slice(3).replace(/^"|"$/g, '')
      const harmless = /^\/dev\/(null|zero|random|urandom|full|stdout|stderr|tty|pts\/)/
      if (dev.startsWith('/dev/') && !harmless.test(dev)) {
        return hit('dd-device', `writes to ${dev}`, 'disk', false)
      }
    }
    return null
  }

  // Redirect straight onto a disk device.
  if (/>{1,2}\s*("?'?\/dev\/(sd|nvme|vd|hd|mmcblk|mapper|loop|md))/.test(simple)) {
    return hit('device-redirect', 'writes to a disk device', 'disk', false)
  }

  if (strict) {
    if (head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun') {
      if (args[0] === 'publish') {
        return hit('npm-publish', 'publishes a package', 'publish', false)
      }
      return null
    }
    if (head === 'gh' && args[0] === 'release' && args[1] === 'create') {
      return hit('gh-release', 'creates a release', 'publish', false)
    }
    if (head === 'vercel') {
      if (args.some((a) => a === '--prod' || a === '--production')) {
        return hit('deploy-prod', 'deploys to production', 'publish', false)
      }
      return null
    }
    if (head === 'firebase' && args.filter((a) => !a.startsWith('-'))[0] === 'deploy') {
      return hit('deploy-prod', 'deploys to production', 'publish', false)
    }
  }

  return null
}

const DOWNLOADERS = ['curl', 'wget', 'fetch', 'http', 'https', 'aria2c']
const PIPE_SHELLS = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash']

// A pipeline that feeds a download into a shell executes whatever arrives. A
// shell after ||, && or ; is not fed by it, so only commands joined by a real
// | count.
function pipeToShell(pipelines: string[][]): RiskHit | null {
  for (const group of pipelines) {
    let fed = false
    for (const simple of group) {
      const w = commandArgv(simple)
      const name = baseName(w[0] ?? '')
      if (fed && PIPE_SHELLS.indexOf(name) !== -1) {
        return hit('pipe-to-shell', 'pipes a download into a shell', 'remote-exec', false)
      }
      if (DOWNLOADERS.indexOf(name) !== -1) fed = true
    }
  }
  return null
}

// Fork bomb: name(){ name|name& };name in any spacing. Checked on the whole
// command because its parens and pipes shred it into harmless fragments.
const FORK_BOMB = /([a-zA-Z_][a-zA-Z0-9_]*|:)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&?\s*;?\s*\}\s*;\s*\1/

/**
 * Classify a shell command against the SPEC 4.3 risk table. Returns the first
 * hit among the simple commands, or null when everything is safe. strict adds
 * the strict-only entries (protected push, force-with-lease, publish, deploy).
 */
export function classifyCommand(cmd: string, opts?: ClassifyOptions): RiskHit | null {
  const strict = opts?.strict === true
  for (const simple of splitCommand(cmd)) {
    const h = checkSimple(simple, strict)
    if (h !== null) return h
  }
  // Pipelines of the line, its substitutions and its sh -c bodies.
  const pipeHit = pipeToShell(splitPipelines(cmd))
  if (pipeHit !== null) return pipeHit
  if (FORK_BOMB.test(normalize(cmd))) {
    return hit('fork-bomb', 'exponential process bomb', 'infra', false)
  }
  return null
}

// Follow a path argument from a directory held as segments below the
// session's directory. Returns the new segments, or null when the path leaves
// that tree or cannot be known (absolute, ~, a variable, above the start).
function below(base: string[], path: string): string[] | null {
  if (path.startsWith('/') || path.startsWith('~') || path.indexOf('$') !== -1 || path.indexOf('`') !== -1) return null
  // Very deep paths are not tracked: unknown counts as elsewhere.
  if (path.length > 4096 || base.length > 64) return null
  const out = [...base]
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.pop() === undefined) return null
      continue
    }
    out.push(part)
  }
  return out
}

const GIT_VALUE_OPTIONS = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']
const ENV_WORDS = ['env', 'export', 'declare', 'typeset', 'local', 'readonly', 'sudo', 'nohup']

/**
 * Does a command act outside the session's repository? A snapshot saves the
 * repository at the session directory, so it cannot protect a command that
 * changes directory away (cd, pushd, popd) or points git elsewhere (-C,
 * --git-dir, --work-tree, GIT_DIR, GIT_WORK_TREE). Paths that cannot be placed
 * below the session directory count as elsewhere.
 */
export function runsElsewhere(cmd: string): boolean {
  let cwd: string[] = []
  const stack: string[][] = []
  for (const simple of splitCommand(cmd)) {
    for (const tok of tokens(simple)) {
      const m = /^(GIT_DIR|GIT_WORK_TREE)=(.*)$/.exec(tok)
      if (m !== null) {
        if (below(cwd, m[2] ?? '') === null) return true
        continue
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok) || tok.startsWith('-') || ENV_WORDS.indexOf(baseName(tok)) !== -1) continue
      break
    }
    const w = commandArgv(simple)
    const head = baseName(w[0] ?? '')
    if (head === 'cd' || head === 'pushd') {
      const target = w.slice(1).filter((a) => a === '-' || !a.startsWith('-'))[0]
      if (target === undefined || target === '-') return true
      const next = below(cwd, target)
      if (next === null) return true
      if (head === 'pushd' && stack.length >= 64) return true
      if (head === 'pushd') stack.push(cwd)
      cwd = next
    } else if (head === 'popd') {
      const back = stack.pop()
      if (back === undefined) return true
      cwd = back
    } else if (head === 'git') {
      let base = cwd
      for (let i = 1; i < w.length; i++) {
        const a = w[i] ?? ''
        if (a === '--') break
        const eq = a.indexOf('=')
        const flag = eq === -1 ? a : a.slice(0, eq)
        if (GIT_VALUE_OPTIONS.indexOf(flag) !== -1) {
          const value = eq === -1 ? (w[++i] ?? '') : a.slice(eq + 1)
          if (flag === '-c' || flag === '--namespace' || flag === '--exec-path') continue
          const next = below(flag === '-C' ? base : cwd, value)
          if (next === null) return true
          if (flag === '-C') base = next
          continue
        }
        if (a.startsWith('-')) continue
        break
      }
    }
  }
  return false
}
