// Secret detection from SPEC 4.4: paths, bash reads, env dumps and redaction.
// Plain TypeScript, no imports.
import { splitCommand, commandTokens, baseName, tokens } from './shell'

const SAMPLE_WORDS = ['example', 'sample', 'template', 'dist']

function lowerBasename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  return (i === -1 ? norm : norm.slice(i + 1)).toLowerCase()
}

function lowerPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

// The brief's sample/template exceptions: .env.example and friends.
function isSampleName(base: string): boolean {
  let parts = base.split('.')
  if (parts.length > 0 && parts[0] === '') parts = parts.slice(1)
  for (const p of parts) {
    if (SAMPLE_WORDS.indexOf(p ?? '') !== -1) return true
  }
  return false
}

/**
 * True when the path names a secret file per SPEC 4.4. Matches by basename
 * and by known parent folders (.aws/credentials, .docker/config.json,
 * .kube/config). Case-insensitive: the OS may be. Paths in allow are spared
 * (exact or basename match).
 */
export function isSecretPath(path: string, allow?: string[]): boolean {
  const p = lowerPath(path)
  const base = lowerBasename(path)
  if (allow !== undefined) {
    for (const a of allow) {
      const al = lowerPath(a)
      if (p === al || base === al) return false
    }
  }
  if (base.endsWith('.pub')) return false
  if (isSampleName(base)) return false
  if (base === '.env' || base.startsWith('.env.')) return true
  if (base.endsWith('.pem')) return true
  if (base.endsWith('.key')) return true
  if (base.endsWith('.p12') || base.endsWith('.pfx')) return true
  if (base.endsWith('.jks') || base.endsWith('.keystore')) return true
  if (base === '.npmrc' || base === '.pypirc' || base === '.netrc' || base === '.git-credentials') return true
  if (base.startsWith('id_rsa') || base.startsWith('id_ed25519') || base.startsWith('id_ecdsa') || base.startsWith('id_dsa')) {
    return true
  }
  if (p.endsWith('.aws/credentials') || p.endsWith('.aws/credentials.bak') || p.endsWith('.aws/credentials.backup') || p.endsWith('.aws/credentials.old') ||
      p.endsWith('.docker/config.json') || p.endsWith('.docker/config.json.bak') || p.endsWith('.docker/config.json.backup') || p.endsWith('.docker/config.json.old') ||
      p.endsWith('.kube/config') || p.endsWith('.kube/config.bak') || p.endsWith('.kube/config.backup') || p.endsWith('.kube/config.old')) {
    return true
  }
  if (base.indexOf('credentials') !== -1 && base.endsWith('.json')) return true
  if (base.indexOf('secret') !== -1 && (base.endsWith('.json') || base.endsWith('.yml') || base.endsWith('.yaml'))) {
    return true
  }
  return false
}

const READERS = [
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'bat',
  'grep',
  'rg',
  'awk',
  'sed',
  'cut',
  'base64',
  'xxd',
  'od',
  'strings',
  'jq',
  'zcat',
  'gzcat',
  'xzcat',
  'gunzip',
  'zstdcat',
  'openssl',
]

// Script runners, handled by their own branch: the value of a config flag is a
// file the process loads itself, and the script can name a secret too.
const RUNNERS = new Set(['node', 'python', 'python3', 'perl', 'ruby', 'bun', 'deno'])

// Short flags may be clustered (node -pe, perl -ne), so the flag letter is the
// last character of the cluster. Long forms and subcommands are listed.
const INLINE_SHORT: Record<string, RegExp> = {
  node: /^-[a-zA-Z]*[ep]$/,
  bun: /^-[a-zA-Z]*[ep]$/,
  python: /^-[a-zA-Z]*c$/,
  python3: /^-[a-zA-Z]*c$/,
  perl: /^-[a-zA-Z]*[eE]$/,
  ruby: /^-[a-zA-Z]*e$/,
}

const INLINE_WORDS: Record<string, string[]> = {
  node: ['--eval', '--print'],
  bun: ['--eval', '--print'],
  deno: ['eval'],
}

// True when the argument carries an inline script for this runner.
function hasInlineFlag(head: string, arg: string): boolean {
  const short = INLINE_SHORT[head]
  if (short !== undefined && short.test(arg)) return true
  const words = INLINE_WORDS[head]
  return words !== undefined && words.indexOf(arg) !== -1
}

// node --eval=code and --print=code carry the script in the flag itself.
function hasInlineAssignment(head: string, arg: string): boolean {
  if (head !== 'node' && head !== 'bun') return false
  return arg.startsWith('--eval=') || arg.startsWith('--print=')
}

// Flags whose next word is a value, not the script. Enough to tell a script
// run from a script fed on stdin.
const VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--env-file', '--env-file-if-exists', '--input-type', '--conditions', '-C', '--cwd'])

// The first protected env file a runner is told to load, or null.
function secretEnvFile(args: string[], allow: string[] | undefined): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    let file: string | undefined
    if (a === '--env-file' || a === '--env-file-if-exists') file = args[i + 1]
    else if (a.startsWith('--env-file=')) file = a.slice('--env-file='.length)
    else if (a.startsWith('--env-file-if-exists=')) file = a.slice('--env-file-if-exists='.length)
    if (file !== undefined && isSecretPath(file, allow)) return file
  }
  return null
}

// Can the script this runner executes print the values it loaded? True for an
// inline script and for a script on stdin (no script file named, or "-").
function scriptCanPrint(head: string, args: string[]): boolean {
  let positional = 0
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (hasInlineFlag(head, a) || hasInlineAssignment(head, a)) return true
    if (a === '-') return true
    if (a === '2>' || a === '2>>') {
      i++
      continue
    }
    // A here-document or here-string is input; what came before it decides.
    if (a === '<<' || a === '<<<') break
    if (a === '<') {
      i++
      continue
    }
    if (VALUE_FLAGS.has(a)) {
      i++
      continue
    }
    // node --test and node --run name what to run without a script argument.
    if (a === '--test' || a === '--run' || a.startsWith('--run=')) {
      positional++
      continue
    }
    if (a.startsWith('-')) continue
    positional++
  }
  return positional === 0
}

// A path token inside inline code that names a secret file.
function secretPathInCode(code: string, allow: string[] | undefined): string | null {
  for (const token of code.split(/[\s'"`()[\]{};,=<>!&|]+/)) {
    if (token !== '' && isSecretPath(token, allow)) return token
  }
  return null
}

// Does stdout of this simple command go to the model? False when stdout is
// redirected to a file (2> alone still prints stdout).
function stdoutRedirected(words: string[]): boolean {
  for (const w of words) {
    if (w === '>' || w === '>>' || w === '1>' || w === '1>>' || w === '&>' || w === '&>>') return true
  }
  return false
}

/**
 * The secret path a bash command would print (cat, head, tail, less, more,
 * bat, grep, rg, awk, sed, cut, base64, xxd, od, strings, cp/scp to stdout),
 * across compound commands. source is not a read. A script runner that loads
 * a protected --env-file and runs an inline or stdin script can print its
 * values, so that counts too. Paths in allow are spared (see isSecretPath).
 * null otherwise.
 */
export function bashReadsSecret(cmd: string, allow?: string[]): string | null {
  for (const simple of splitCommand(cmd)) {
    const words = commandTokens(simple)
    if (words.length === 0) continue
    const head = baseName(words[0] ?? '')
    const args = words.slice(1)
    if (head === 'cp' || head === 'scp') {
      const dest = args[args.length - 1]
      if (dest === '/dev/stdout' || dest === '-' || dest === '/dev/fd/1' || dest === '/proc/self/fd/1') {
        for (const a of args.slice(0, -1)) {
          if (isSecretPath(a, allow) === true) return a
        }
      }
      continue
    }
    const isRunner = RUNNERS.has(head)
    if (isRunner === false && READERS.indexOf(head) === -1) continue
    if (stdoutRedirected(words)) continue
    if (head === 'sed' && args.some((a) => a === '-i' || a === '--in-place' || a.startsWith('-i'))) continue
    if (isRunner) {
      // Loading the file is no read, but a script that can print runs after it.
      const loaded = secretEnvFile(args, allow)
      if (loaded !== null && scriptCanPrint(head, args)) return loaded
    }
    for (let i = 0; i < args.length; i++) {
      const a = args[i] ?? ''
      if (a === '2>' || a === '2>>') {
        i++
        continue
      }
      if (a === '<' || a === '<<') continue
      if (a === '>' || a === '>>' || a === '1>' || a === '1>>' || a === '&>') break
      // --env-file .env names the file the process loads, not a read.
      if (a === '--env-file' || a === '--env-file-if-exists') {
        i++
        continue
      }
      if (a.startsWith('--env-file=') || a.startsWith('--env-file-if-exists=')) continue
      if (isRunner && (hasInlineFlag(head, a) || hasInlineAssignment(head, a))) {
        const code = hasInlineAssignment(head, a) ? a.slice(a.indexOf('=') + 1) : args[i + 1]
        if (!hasInlineAssignment(head, a)) i++
        if (code !== undefined) {
          const hit = secretPathInCode(code, allow)
          if (hit !== null) return hit
        }
        continue
      }
      if (isSecretPath(a, allow) === true) return a
    }
  }
  return null
}

// env -0 and env --null print the whole environment NUL-separated.
// commandTokens reads the flag as the command env runs, so this looks at the
// plain words.
function isNullSeparatedEnv(simple: string): boolean {
  const t = tokens(simple)
  let i = 0
  while (i < t.length && ['sudo', 'nohup'].indexOf(baseName(t[i] ?? '')) !== -1) i++
  if (baseName(t[i] ?? '') !== 'env') return false
  let formatted = false
  for (const a of t.slice(i + 1)) {
    if (a === '-0' || a === '--null') formatted = true
    else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) return false
  }
  return formatted
}

/**
 * True for bare env, printenv, set (the bash dump), export -p and bare
 * export, also in their null-separated forms (env -0, printenv --null).
 * env FOO=1 cmd and printenv HOME are not dumps.
 */
export function isEnvDump(cmd: string): boolean {
  for (const simple of splitCommand(cmd)) {
    if (isNullSeparatedEnv(simple)) return true
    const words = commandTokens(simple)
    if (words.length === 0) continue
    const head = baseName(words[0] ?? '')
    const args = words.slice(1)
    if (head === 'env') {
      if (args.length === 0) return true
      let k = 0
      while (k < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[k] ?? '')) k++
      if (k === args.length) return true
    }
    // -0 and --null only change the separator, not what is printed.
    if (head === 'printenv' && args.every(a => a === '-0' || a === '--null')) return true
    if (head === 'set' && args.length === 0) return true
    if (head === 'export' && (args.length === 0 || args[0] === '-p')) return true
  }
  return false
}

// Shannon entropy in bits per character.
function entropy(s: string): number {
  if (s.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let h = 0
  for (const count of freq.values()) {
    const p = count / s.length
    h -= p * Math.log2(p)
  }
  return h
}

// Character classes present: lower, upper, digit, other.
function classCount(s: string): number {
  let lower = false
  let upper = false
  let digit = false
  let other = false
  for (const ch of s) {
    if (ch >= 'a' && ch <= 'z') lower = true
    else if (ch >= 'A' && ch <= 'Z') upper = true
    else if (ch >= '0' && ch <= '9') digit = true
    else other = true
  }
  return (lower ? 1 : 0) + (upper ? 1 : 0) + (digit ? 1 : 0) + (other ? 1 : 0)
}

const PLACEHOLDER = /^(x+|X+|\*+|<[^>]*>|\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|changeme.*|change-me.*|todo.*|placeholder.*)$/i

// Prefix-anchored token patterns, all linear scans.
const TOKEN_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'anthropic', re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai', re: /(?<![A-Za-z0-9_-])sk-proj-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai', re: /(?<![A-Za-z0-9_-])sk-(?!ant-|proj-)[A-Za-z0-9]{32,}/g },
  { kind: 'github', re: /(?<![A-Za-z0-9_])gh[pous]_[A-Za-z0-9]{36,}/g },
  { kind: 'github', re: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{60,}/g },
  { kind: 'gitlab', re: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'slack', re: /(?<![A-Za-z0-9_-])xox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws', re: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])/g },
  { kind: 'google', re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g },
  { kind: 'stripe', re: /(?<![A-Za-z0-9_-])(?:sk|rk)_live_[A-Za-z0-9]{20,}/g },
  { kind: 'npm', re: /(?<![A-Za-z0-9_-])npm_[A-Za-z0-9]{30,}/g },
  { kind: 'huggingface', re: /(?<![A-Za-z0-9_-])hf_[A-Za-z0-9]{30,}/g },
]

const PRIVATE_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g
const PRIVATE_END = '-----END '
const PRIVATE_KEY_TAIL = 'PRIVATE KEY-----'
const REDACTED_KEY = '[redacted:private-key]'

// BEGIN-to-END pairing via one scan for each marker plus a binary search per
// BEGIN: strictly linear, safe on adversarial input.
function redactPrivateKeys(text: string, bump: (kind: string) => void): string {
  PRIVATE_BEGIN.lastIndex = 0
  const begins: { start: number; after: number }[] = []
  let m: RegExpExecArray | null
  while ((m = PRIVATE_BEGIN.exec(text)) !== null) {
    begins.push({ start: m.index, after: m.index + m[0].length })
  }
  if (begins.length === 0) return text
  // One END line counts when PRIVATE KEY----- appears on it. The next newline
  // and the next PRIVATE KEY----- are cached, so a line full of END markers
  // costs one scan, not one per marker.
  const ends: number[] = []
  let lineEnd = -1
  let keyAt = -1
  let e = text.indexOf(PRIVATE_END)
  while (e !== -1) {
    if (lineEnd < e) {
      const nl = text.indexOf('\n', e + PRIVATE_END.length)
      lineEnd = nl === -1 ? text.length : nl
    }
    if (keyAt !== Infinity && keyAt < e) {
      const found = text.indexOf(PRIVATE_KEY_TAIL, e)
      keyAt = found === -1 ? Infinity : found
    }
    if (keyAt < lineEnd) ends.push(lineEnd)
    e = text.indexOf(PRIVATE_END, e + PRIVATE_END.length)
  }
  let out = ''
  let copied = 0
  for (const b of begins) {
    if (b.start < copied) continue
    let lo = 0
    let hi = ends.length - 1
    let pick = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const v = ends[mid] ?? -1
      if (v > b.after) {
        pick = v
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }
    if (pick === -1) continue
    out += text.slice(copied, b.start) + REDACTED_KEY
    copied = pick
    bump('private-key')
  }
  out += text.slice(copied)
  return out
}

// Names whose value is worth checking: password, secret, token, api_key.
const ASSIGNMENT_WORD = /password|secret|token|api[_-]key/gi

const MIN_ASSIGNED = 20

// The characters \s matches, tested by code: a regex call per character is slow.
function isSpace(text: string, at: number): boolean {
  const c = text.charCodeAt(at)
  if (c <= 32) return c === 32 || (c >= 9 && c <= 13)
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029
    || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
}

// key = value assignments, found with one pass over the text: the name words
// are located first, then each hit is read forward once. A pattern that
// retried the identifier before the name at every position would be
// quadratic. The key text is kept as it is, so it needs no backward scan.
function redactAssignments(text: string, bump: (kind: string) => void): string {
  const n = text.length
  let out = ''
  let copied = 0
  ASSIGNMENT_WORD.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ASSIGNMENT_WORD.exec(text)) !== null) {
    const wordEnd = m.index + m[0].length
    // Names may overlap (secretoken holds secret and token), so a miss moves
    // the search by one character.
    ASSIGNMENT_WORD.lastIndex = m.index + 1
    let p = wordEnd
    if (text[p] === '"' || text[p] === "'") p++
    while (p < n && isSpace(text, p)) p++
    if (text[p] !== '=' && text[p] !== ':') continue
    p++
    while (p < n && isSpace(text, p)) p++
    if (text[p] === '"' || text[p] === "'") p++
    const valueStart = p
    while (p < n && !isSpace(text, p) && text[p] !== '"' && text[p] !== "'") p++
    if (p - valueStart < MIN_ASSIGNED) continue
    // A value that was read is not searched again, kept or not.
    ASSIGNMENT_WORD.lastIndex = p
    const value = text.slice(valueStart, p)
    if (PLACEHOLDER.test(value) || entropy(value) < 3.5 || classCount(value) < 3) continue
    bump('assignment')
    out += text.slice(copied, wordEnd) + '=[redacted:assignment]'
    copied = p
  }
  return copied === 0 ? text : out + text.slice(copied)
}

export interface RedactionResult {
  text: string
  hits: { kind: string; count: number }[]
}

/**
 * Replace high-precision secret patterns with [redacted:<kind>]. Generic
 * password=/secret=/token=/api_key= values count only when at least 20
 * characters, high entropy, 3 of 4 character classes and not a placeholder.
 * All scans are linear, no nested quantifiers: safe on 1 MB of text.
 */
export function redactSecrets(text: string): RedactionResult {
  const counts = new Map<string, number>()
  const bump = (kind: string) => counts.set(kind, (counts.get(kind) ?? 0) + 1)
  let out = redactPrivateKeys(text, bump)

  for (const p of TOKEN_PATTERNS) {
    const found = out.match(p.re)
    if (found !== null) {
      for (let i = 0; i < found.length; i++) bump(p.kind)
      out = out.replace(p.re, '[redacted:' + p.kind + ']')
    }
    p.re.lastIndex = 0
  }

  out = redactAssignments(out, bump)

  const hits: { kind: string; count: number }[] = []
  for (const [kind, count] of counts) hits.push({ kind, count })
  hits.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
  return { text: out, hits }
}
