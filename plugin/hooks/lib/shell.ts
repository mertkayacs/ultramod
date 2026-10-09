// Shell parsing for the guard mods. Plain TypeScript, no imports: this runs
// inside the hooks environment where only web APIs exist.

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n'
}

// Find the ) matching the ( that opens a $( ... ), honoring quotes, escapes
// and nesting. Returns -1 when unterminated.
function findCloseParen(src: string, open: number): number {
  let depth = 0
  let i = open
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === "'") {
      const j = src.indexOf("'", i + 1)
      if (j === -1) return -1
      i = j + 1
      continue
    }
    if (c === '"') {
      i++
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

// Find the closing backtick of a `...` substitution.
function findCloseBacktick(src: string, open: number): number {
  let i = open
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1)
      if (j === -1) return -1
      i = j + 1
      continue
    }
    if (c === '`') return i
    i++
  }
  return -1
}

// Find the } matching the { of a ${ ... } expansion, honoring quotes and
// escapes. Returns -1 when unterminated.
function findCloseBrace(src: string, open: number): number {
  let depth = 0
  let i = open
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === "'") {
      const j = src.indexOf("'", i + 1)
      if (j === -1) return -1
      i = j + 1
      continue
    }
    if (c === '"') {
      i++
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

// Read a heredoc delimiter after << or <<- and return where the mark ends.
function readHeredocMark(src: string, i: number): { end: number; delim: string } {
  const n = src.length
  let j = i
  while (j < n && (src[j] === '-' || src[j] === '+')) j++
  while (j < n && (src[j] === ' ' || src[j] === '\t')) j++
  if (j < n && (src[j] === "'" || src[j] === '"')) {
    const q = src.charAt(j)
    const k = src.indexOf(q, j + 1)
    if (k === -1) return { end: n, delim: '' }
    return { end: k + 1, delim: src.slice(j + 1, k) }
  }
  let delim = ''
  while (j < n && !isSpace(src.charAt(j)) && ';|&()<>'.indexOf(src.charAt(j)) === -1) {
    delim += src[j]
    j++
  }
  return { end: j, delim }
}

// Find where a heredoc body ends: the line equal to the delimiter, leading
// tabs allowed for <<-. Returns the index just past the terminator line.
function findHeredocEnd(src: string, bodyStart: number, delim: string): number {
  const n = src.length
  if (delim === '') return n
  let i = bodyStart
  while (i <= n) {
    const nl = src.indexOf('\n', i)
    const lineEnd = nl === -1 ? n : nl
    if (src.slice(i, lineEnd).replace(/^\t+/, '') === delim) return Math.min(n, lineEnd + 1)
    if (nl === -1) return n
    i = nl + 1
  }
  return n
}

interface ScanResult {
  parts: string[]
  subs: string[]
  // Simple commands joined by a real |, one list per pipeline, in order.
  groups: string[][]
}

// A heredoc body: it belongs to the part at index owner and spans src[start, end).
interface Heredoc {
  owner: number
  start: number
  end: number
}

// Split one level into simple commands, extracting $( ) and ` ` bodies.
// depth caps recursion into nested substitutions.
function scan(src: string, depth: number): ScanResult {
  const parts: string[] = []
  const subs: string[] = []
  const groups: string[][] = []
  // Each failed search for a closing bracket reads to the end of the text, so
  // after a few misses the rest is taken as plain text (its ( ) still split
  // commands) and the scan stays linear.
  let misses = 0
  const find = (closer: (text: string, open: number) => number, open: number): number => {
    if (misses >= 8) return -1
    const r = closer(src, open)
    if (r === -1) misses++
    return r
  }
  let cur = ''
  // True right after a | (not ||): the next command joins the open pipeline.
  let joinNext = false
  const push = () => {
    const t = cur.trim()
    if (t !== '') {
      parts.push(t)
      const open = groups[groups.length - 1]
      if (joinNext && open !== undefined) open.push(t)
      else groups.push([t])
      joinNext = false
    }
    cur = ''
  }
  // Heredoc bodies start on the line after the declaration. The rest of the
  // declaration line is ordinary command text, so the bodies are skipped when
  // the scan reaches that line break and handed back to their owners.
  let pending: { from: number; bodies: Heredoc[] } | null = null
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src.charAt(i)
    if (pending !== null && i === pending.from) {
      push()
      let last = i
      for (const b of pending.bodies) {
        if (b.owner < parts.length) parts[b.owner] += src.slice(b.start, b.end)
        last = b.end
      }
      for (const b of pending.bodies) {
        if (b.owner < parts.length) parts[b.owner] = (parts[b.owner] ?? '').trimEnd()
      }
      pending = null
      i = last
      continue
    }
    if (isSpace(c)) {
      if (c === '\n') push()
      else cur += c
      i++
      continue
    }
    if (c === '#' && (cur === '' || isSpace(cur.charAt(cur.length - 1)))) {
      // A comment runs to the end of the line and is never executed.
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? n : nl
      continue
    }
    if (c === "'") {
      const j = src.indexOf("'", i + 1)
      const end = j === -1 ? n : j
      cur += src.slice(i, end + 1)
      i = end + 1
      continue
    }
    if (c === '\\' && i + 1 < n) {
      if (src[i + 1] === '\n') {
        i += 2
        continue
      }
      cur += c + src[i + 1]
      i += 2
      continue
    }
    if (c === '"') {
      let j = i + 1
      let inner = ''
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) {
          if (src.charAt(j + 1) !== '\n') inner += src.charAt(j) + src.charAt(j + 1)
          j += 2
          continue
        }
        if (src[j] === '$' && src[j + 1] === '(' && depth < 3) {
          const close = find(findCloseParen, j + 1)
          if (close !== -1) {
            subs.push(src.slice(j + 2, close))
            inner += src.slice(j, close + 1)
            j = close + 1
            continue
          }
        }
        if (src[j] === '`' && depth < 3) {
          const close = find(findCloseBacktick, j + 1)
          if (close !== -1) {
            subs.push(src.slice(j + 1, close))
            inner += src.slice(j, close + 1)
            j = close + 1
            continue
          }
        }
        inner += src[j]
        j++
      }
      cur += '"' + inner + '"'
      i = j + 1
      continue
    }
    if (c === '$' && src[i + 1] === '{') {
      // A parameter expansion: a # inside is not a comment, but a command
      // substitution inside still runs.
      const close = find(findCloseBrace, i + 1)
      if (close !== -1) {
        if (depth < 3) subs.push(src.slice(i + 2, close))
        cur += src.slice(i, close + 1)
        i = close + 1
        continue
      }
    }
    if (c === '$' && src[i + 1] === '(' && depth < 3) {
      const close = find(findCloseParen, i + 1)
      if (close !== -1) {
        subs.push(src.slice(i + 2, close))
        cur += src.slice(i, close + 1)
        i = close + 1
        continue
      }
    }
    if (c === '`' && depth < 3) {
      const close = find(findCloseBacktick, i + 1)
      if (close !== -1) {
        subs.push(src.slice(i + 1, close))
        cur += src.slice(i, close + 1)
        i = close + 1
        continue
      }
    }
    if ((c === '&' && src[i + 1] === '&') || (c === '|' && src[i + 1] === '|')) {
      push()
      joinNext = false
      i += 2
      continue
    }
    if (c === '&') {
      // A single top-level & backgrounds the command and splits like ;. The
      // redirect forms keep their ampersand: &> and &>> ahead, >& behind as
      // in 2>&1 and >&2.
      const prev = cur.length > 0 ? cur.charAt(cur.length - 1) : ''
      if (src[i + 1] !== '>' && prev !== '>') {
        push()
        joinNext = false
        i++
        continue
      }
    }
    if (c === '|') {
      push()
      joinNext = true
      i++
      // |& pipes stderr too
      if (src[i] === '&' && src[i + 1] !== '>') i++
      continue
    }
    if (c === ';' || c === ')') {
      push()
      joinNext = false
      i++
      continue
    }
    if (c === '(') {
      push()
      i++
      continue
    }
    if (c === '<') {
      if (src[i + 1] === '<' && src[i + 2] !== '<') {
        // Heredoc: the body belongs to this command, newlines inside do
        // not split, so SQL inside it stays attached to its carrier.
        const mark = readHeredocMark(src, i + 2)
        cur += src.slice(i, mark.end)
        i = mark.end
        if (mark.delim === '') continue
        if (pending !== null && pending.from < i) pending = null
        const from: number = pending !== null ? pending.from : src.indexOf('\n', i)
        if (from === -1) continue
        const prev = pending !== null ? pending.bodies[pending.bodies.length - 1] : undefined
        const first = prev === undefined
        const start = prev !== undefined ? prev.end : from + 1
        const end = findHeredocEnd(src, start, mark.delim)
        if (pending === null) pending = { from, bodies: [] }
        pending.bodies.push({ owner: parts.length, start: first ? from : start, end })
        continue
      }
      if (src[i + 1] === '<') {
        cur += '<<<'
        i += 3
        continue
      }
    }
    cur += c
    i++
  }
  push()
  return { parts, subs, groups }
}

const SHELLS = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'ash']

// If simple runs a shell with -c '<body>' (combined flags like -lc allowed,
// wrappers like sudo and env stripped), or eval, return the body. Returns
// null for anything else.
function dashCArgument(simple: string): string | null {
  const words = commandTokens(simple)
  if (words.length < 2) return null
  const head = baseName(words[0] ?? '')
  if (head === 'eval') return words.slice(1).join(' ')
  if (!SHELLS.includes(head)) return null
  for (let i = 1; i < words.length - 1; i++) {
    const w = words[i] ?? ''
    if (w === '--') return null
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(w)) return words[i + 1] ?? null
    // -o and -O take an option name
    if (w === '-o' || w === '+o' || w === '-O' || w === '+O') {
      i++
      continue
    }
    if (w.startsWith('-')) continue
    return null
  }
  return null
}

interface Analysis {
  simples: string[]
  pipelines: string[][]
}

function analyze(cmd: string): Analysis {
  const top = scan(cmd, 0)
  const simples: string[] = []
  const pipelines: string[][] = [...top.groups]
  const expand = (text: string, depth: number) => {
    const r = scan(text, depth)
    pipelines.push(...r.groups)
    for (const p of r.parts) {
      simples.push(p)
      const body = dashCArgument(p)
      if (body !== null && depth < 2) expand(body, depth + 1)
    }
    for (const s of r.subs) expand(s, depth + 1)
  }
  for (const p of top.parts) {
    simples.push(p)
    const body = dashCArgument(p)
    if (body !== null) expand(body, 1)
  }
  for (const s of top.subs) expand(s, 1)
  return { simples, pipelines }
}

/**
 * Split a shell line into simple commands on &&, ||, ;, |, a single & and
 * newlines, respecting quotes, backslash escapes, comments and heredoc
 * bodies. Redirect operators (&>, 2>&1, >&2) stay attached. The inner
 * commands of $( ... ), backticks and sh -c '...' are included as their own
 * entries.
 */
export function splitCommand(cmd: string): string[] {
  return analyze(cmd).simples
}

/**
 * The pipelines of a shell line: each list holds the simple commands joined by
 * a real | (or |&), in order. Substitutions and sh -c bodies are included as
 * their own pipelines.
 */
export function splitPipelines(cmd: string): string[][] {
  return analyze(cmd).pipelines
}

interface Word {
  text: string
  // An unquoted redirect operator such as >, 2>, &> or >&.
  op: boolean
}

// risk mode: comments are dropped and a file descriptor glues onto any
// redirect operator, so 2>&1 is one operator and "2 >&1" is a word and an
// operator.
function lex(simple: string, risk: boolean): Word[] {
  const words: Word[] = []
  let cur = ''
  let started = false
  const push = () => {
    if (started) {
      words.push({ text: cur, op: false })
      cur = ''
      started = false
    }
  }
  let i = 0
  const n = simple.length
  while (i < n) {
    const c = simple.charAt(i)
    if (isSpace(c)) {
      push()
      i++
      continue
    }
    if (risk && c === '#' && !started) {
      const nl = simple.indexOf('\n', i)
      i = nl === -1 ? n : nl
      continue
    }
    if (c === "'") {
      const j = simple.indexOf("'", i + 1)
      const end = j === -1 ? n : j
      cur += simple.slice(i + 1, end)
      started = true
      i = end + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n && simple[j] !== '"') {
        if (simple[j] === '\\' && j + 1 < n) {
          if (simple[j + 1] !== '\n') cur += simple[j + 1]
          j += 2
          continue
        }
        cur += simple[j]
        j++
      }
      started = true
      i = j + 1
      continue
    }
    if (c === '\\' && i + 1 < n) {
      if (simple[i + 1] !== '\n') cur += simple[i + 1]
      started = true
      i += 2
      continue
    }
    if (c === '>' || c === '<' || (c === '&' && (simple[i + 1] === '>' || simple[i + 1] === '<'))) {
      let j = i
      while (j < n && (simple[j] === '>' || simple[j] === '<' || simple[j] === '&')) j++
      const op = simple.slice(i, j)
      // A file descriptor number glues onto the operator: 2>, 1>>.
      const glue = risk ? op.startsWith('>') || op.startsWith('<') : op === '>' || op === '>>'
      if (glue && started && /^\d+$/.test(cur)) {
        words.push({ text: cur + op, op: true })
        cur = ''
        started = false
        i = j
        continue
      }
      if (op.length > 1 && started && cur === '&') {
        words.push({ text: cur + op, op: true })
        cur = ''
        started = false
        i = j
        continue
      }
      push()
      words.push({ text: op, op: true })
      i = j
      continue
    }
    if (c === '|') {
      push()
      i++
      continue
    }
    cur += c
    started = true
    i++
  }
  push()
  return words
}

/**
 * Shell-like word split with quotes and escapes removed. Redirect operators
 * (>, >>, <, 2>, &>) stand as their own tokens.
 */
export function tokens(simple: string): string[] {
  return lex(simple, false).map((w) => w.text)
}

/**
 * The words the program receives: quotes removed, comments dropped, and every
 * redirect operator with its target left out, so `2> /dev/null` and `>&2`
 * are not arguments. A quoted > stays a word.
 */
export function argv(simple: string): string[] {
  const out: string[] = []
  const all = lex(simple, true)
  for (let i = 0; i < all.length; i++) {
    const w = all[i]
    if (w === undefined) continue
    if (w.op) {
      i++
      continue
    }
    out.push(w.text)
  }
  return out
}

/**
 * Collapse whitespace and trim. Used for loop signatures.
 */
export function normalize(cmd: string): string {
  return cmd.replace(/\s+/g, ' ').trim()
}

/**
 * Basename of a path-like token, so /bin/rm and rm match.
 */
export function baseName(token: string): string {
  const i = token.lastIndexOf('/')
  return i === -1 ? token : token.slice(i + 1)
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

// Wrappers that run the command after them: the flags that take a value and
// how many plain words (a duration) come before the command.
const WRAPPERS: Record<string, { value: readonly string[]; lead?: number }> = {
  sudo: {
    value: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '-r', '-t', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--close-from'],
  },
  doas: { value: ['-u', '-C'] },
  nohup: { value: [] },
  exec: { value: ['-a'] },
  command: { value: [] },
  builtin: { value: [] },
  time: { value: [] },
  setsid: { value: [] },
  nice: { value: ['-n', '--adjustment'] },
  ionice: { value: ['-c', '-n', '-p', '--class', '--classdata'] },
  timeout: { value: ['-s', '-k', '--signal', '--kill-after'], lead: 1 },
}

function stripWrappers(t: string[]): string[] {
  let i = 0
  while (i < t.length) {
    const b = baseName(t[i] ?? '')
    if (ASSIGNMENT.test(t[i] ?? '')) {
      // VAR=value in front of a command; a line of only assignments stays.
      let k = i
      while (k < t.length && ASSIGNMENT.test(t[k] ?? '')) k++
      if (k >= t.length) break
      i = k
      continue
    }
    const w = WRAPPERS[b]
    if (w !== undefined) {
      let j = i + 1
      while (j < t.length) {
        const f = t[j] ?? ''
        if (f === '--') {
          j++
          break
        }
        if (!f.startsWith('-') || f === '-') break
        j += !f.includes('=') && w.value.indexOf(f) !== -1 ? 2 : 1
      }
      j += w.lead ?? 0
      i = j
      continue
    }
    if (b === 'env') {
      let j = i + 1
      while (j < t.length) {
        const f = t[j] ?? ''
        if (ASSIGNMENT.test(f) || f === '-i' || f === '--ignore-environment') j++
        else if (f === '-u' || f === '-C' || f === '--unset' || f === '--chdir') j += 2
        else break
      }
      if (j > i + 1 && j >= t.length) {
        // pairs but no command: env prints the environment
        return t.slice(i)
      }
      if (j < t.length) {
        i = j
        continue
      }
      // bare env alone: kept as the head, the dump case
    }
    break
  }
  return t.slice(i)
}

/**
 * Tokens of a simple command with wrapper prefixes stripped: sudo, nohup, env
 * with VAR=value pairs, VAR=value assignments and similar. Bare env (the
 * dump) is kept as the head.
 */
export function commandTokens(simple: string): string[] {
  return stripWrappers(tokens(simple))
}

/**
 * commandTokens over argv: redirects and comments are gone too, so a
 * redirect in front of the command does not hide it.
 */
export function commandArgv(simple: string): string[] {
  return stripWrappers(argv(simple))
}
