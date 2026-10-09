import { test, expect, describe } from 'claude-code/testing'
import { splitCommand, splitPipelines, tokens, argv, normalize, baseName, commandTokens, commandArgv, analyzeCommand, shellInvocation, substitutionCommands } from '../hooks/lib/shell'

describe('splitCommand', () => {
  test('splits on every separator', () => {
    expect(splitCommand('a && b || c; d | e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('splits on newlines', () => {
    expect(splitCommand('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  test('a top-level single & splits like ;', () => {
    expect(splitCommand('a & b')).toEqual(['a', 'b'])
  })

  test('a backgrounded lint leaves the rm its own command', () => {
    expect(splitCommand('eslint . & rm -rf ~/data')).toEqual(['eslint .', 'rm -rf ~/data'])
  })

  test('redirect operators keep their ampersand', () => {
    expect(splitCommand('cmd &> log')).toEqual(['cmd &> log'])
    expect(splitCommand('cmd &>> log')).toEqual(['cmd &>> log'])
    expect(splitCommand('cmd 2>&1')).toEqual(['cmd 2>&1'])
    expect(splitCommand('cmd >&2')).toEqual(['cmd >&2'])
  })

  test('keeps separators inside single quotes', () => {
    expect(splitCommand("echo 'a; b | c' && d")).toEqual(["echo 'a; b | c'", 'd'])
  })

  test('keeps separators inside double quotes', () => {
    expect(splitCommand('echo "a && b"; c')).toEqual(['echo "a && b"', 'c'])
  })

  test('respects backslash escapes', () => {
    expect(splitCommand('echo a\\;b; c')).toEqual(['echo a\\;b', 'c'])
  })

  test('backslash newline is a continuation', () => {
    expect(splitCommand('a \\\nb')).toEqual(['a b'])
  })

  test('extracts the body of $( )', () => {
    expect(splitCommand('echo $(rm -rf /)')).toEqual(['echo $(rm -rf /)', 'rm -rf /'])
  })

  test('extracts nested $( ) one command deep', () => {
    const parts = splitCommand('echo $(ls $(pwd))')
    expect(parts.indexOf('ls $(pwd)')).toBeGreaterThan(-1)
    expect(parts.indexOf('pwd')).toBeGreaterThan(-1)
  })

  test('extracts the body of backticks', () => {
    expect(splitCommand('echo `ls -la`')).toEqual(['echo `ls -la`', 'ls -la'])
  })

  test('extracts $( ) inside double quotes', () => {
    expect(splitCommand('echo "$(whoami)"')).toEqual(['echo "$(whoami)"', 'whoami'])
  })

  test('extracts bash -c inner command', () => {
    expect(splitCommand("bash -c 'rm -rf /'")).toEqual(["bash -c 'rm -rf /'", 'rm -rf /'])
  })

  test('extracts fish -c inner command', () => {
    expect(splitCommand("fish -c 'rm -rf /'")).toEqual(["fish -c 'rm -rf /'", 'rm -rf /'])
  })

  test('extracts csh -c inner command', () => {
    expect(splitCommand("csh -c 'rm -rf /'")).toEqual(["csh -c 'rm -rf /'", 'rm -rf /'])
  })

  test('extracts sh -c inner command with combined flags', () => {
    expect(splitCommand('sh -lc "drop table x"')).toEqual(['sh -lc "drop table x"', 'drop table x'])
  })

  test('extracts from compound wrappers', () => {
    const parts = splitCommand('cd /tmp && bash -c "psql -c \'drop table x\'"')
    expect(parts.indexOf("psql -c 'drop table x'")).toBeGreaterThan(-1)
  })

  test('extracts env bash -c inner command', () => {
    const parts = splitCommand('env bash -c "rm -rf /"')
    expect(parts.indexOf('rm -rf /')).toBeGreaterThan(-1)
  })

  test('extracts /usr/bin/env bash -c inner command', () => {
    const parts = splitCommand('/usr/bin/env bash -c "rm -rf /"')
    expect(parts.indexOf('rm -rf /')).toBeGreaterThan(-1)
  })

  test('does not treat bash script.sh as -c', () => {
    expect(splitCommand('bash script.sh')).toEqual(['bash script.sh'])
  })

  test('heredoc body stays attached', () => {
    expect(splitCommand('psql <<EOF\ndrop table users;\nEOF')).toEqual([
      'psql <<EOF\ndrop table users;\nEOF',
    ])
  })

  test('heredoc body with quoted delimiter stays attached', () => {
    expect(splitCommand("cat > s.sh <<'EOF'\nrm -rf /\nEOF")).toEqual([
      "cat > s.sh <<'EOF'\nrm -rf /\nEOF",
    ])
  })

  test('empty input gives nothing', () => {
    expect(splitCommand('')).toEqual([])
    expect(splitCommand('   \n  ')).toEqual([])
  })

  test('unterminated quotes still produce a command', () => {
    expect(splitCommand("echo 'oops")).toEqual(["echo 'oops"])
  })
})

describe('tokens', () => {
  test('splits on whitespace', () => {
    expect(tokens('rm -rf /')).toEqual(['rm', '-rf', '/'])
  })

  test('single quoted text loses the quotes', () => {
    expect(tokens("echo 'a b c'")).toEqual(['echo', 'a b c'])
  })

  test('double quoted text loses the quotes', () => {
    expect(tokens('echo "a b"')).toEqual(['echo', 'a b'])
  })

  test('backslash escapes lose the backslash', () => {
    expect(tokens('echo a\\ b')).toEqual(['echo', 'a b'])
  })

  test('redirect operators stand alone', () => {
    expect(tokens('cat f > out')).toEqual(['cat', 'f', '>', 'out'])
  })

  test('file descriptor glues onto the redirect', () => {
    expect(tokens('cat f 2>/dev/null')).toEqual(['cat', 'f', '2>', '/dev/null'])
  })

  test('append redirect', () => {
    expect(tokens('echo x >> f')).toEqual(['echo', 'x', '>>', 'f'])
  })
})

describe('normalize and helpers', () => {
  test('normalize collapses whitespace and trims', () => {
    expect(normalize('  a \n\t b   c  ')).toBe('a b c')
  })

  test('baseName takes the last path segment', () => {
    expect(baseName('/bin/rm')).toBe('rm')
    expect(baseName('rm')).toBe('rm')
    expect(baseName('./node_modules/.bin/vitest')).toBe('vitest')
  })

  test('commandTokens strips sudo and env pairs', () => {
    expect(commandTokens('sudo rm -rf /')).toEqual(['rm', '-rf', '/'])
    expect(commandTokens('env FOO=1 BAR=2 node x.js')).toEqual(['node', 'x.js'])
    expect(commandTokens('nohup npm test')).toEqual(['npm', 'test'])
  })

  test('commandTokens keeps bare env as the head', () => {
    expect(commandTokens('env')).toEqual(['env'])
    expect(commandTokens('env FOO=1')).toEqual(['env', 'FOO=1'])
  })

  test('commandTokens unwraps env before a command', () => {
    expect(commandTokens('env rm -rf /')).toEqual(['rm', '-rf', '/'])
    expect(commandTokens('env GIT_DIR=x git status')).toEqual(['git', 'status'])
  })
})

describe('heredoc and comment parsing', () => {
  test('a command after the declaration on the same line is its own command', () => {
    expect(splitCommand('psql <<SQL; rm -rf /x\nSELECT 1;\nSQL')).toEqual(['psql <<SQL\nSELECT 1;\nSQL', 'rm -rf /x'])
  })

  test('a command after the terminator line is its own command', () => {
    expect(splitCommand('cat << EOF\nhello\nEOF\nrm -rf /y')).toEqual(['cat << EOF\nhello\nEOF', 'rm -rf /y'])
  })

  test('two heredocs on one line hand each body back', () => {
    expect(splitCommand('cat <<A <<B\none\nA\ntwo\nB\nls')).toEqual(['cat <<A <<B\none\nA\ntwo\nB', 'ls'])
  })

  test('a comment is dropped and its quote does not open a string', () => {
    expect(splitCommand("ls # it's\npwd")).toEqual(['ls', 'pwd'])
  })

  test('# inside a word or an expansion is not a comment', () => {
    expect(splitCommand('echo a#b')).toEqual(['echo a#b'])
    expect(splitCommand('echo ${#x}; ls')).toEqual(['echo ${#x}', 'ls'])
  })
})

describe('splitPipelines', () => {
  test('groups commands joined by a real pipe', () => {
    expect(splitPipelines('a | b | c; d')).toEqual([['a', 'b', 'c'], ['d']])
  })

  test('|| and && close a pipeline', () => {
    expect(splitPipelines('a | b || c')).toEqual([['a', 'b'], ['c']])
    expect(splitPipelines('a && b | c')).toEqual([['a'], ['b', 'c']])
  })

  test('|& and a line break after the pipe continue it', () => {
    expect(splitPipelines('a |& b')).toEqual([['a', 'b']])
    expect(splitPipelines('a |\nb')).toEqual([['a', 'b']])
  })

  test('sh -c bodies and substitutions bring their own pipelines', () => {
    expect(splitPipelines("sh -c 'a | b'")).toContainEqual(['a', 'b'])
    expect(splitPipelines('echo $(a | b)')).toContainEqual(['a', 'b'])
  })

  test('a quoted name stays one command', () => {
    expect(splitPipelines('curl x | "sh"')).toEqual([['curl x', '"sh"']])
  })
})

describe('argv and wrappers', () => {
  test('redirect operators and their targets are not arguments', () => {
    expect(argv('rm -rf a 2> /dev/null')).toEqual(['rm', '-rf', 'a'])
    expect(argv('rm -rf a 2>&1')).toEqual(['rm', '-rf', 'a'])
    expect(argv('rm -rf a >&2')).toEqual(['rm', '-rf', 'a'])
    expect(argv('2>/dev/null rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(argv('rm a 2 >&1')).toEqual(['rm', 'a', '2'])
  })

  test('a quoted > stays a word and a comment is dropped', () => {
    expect(argv("rm '>' a")).toEqual(['rm', '>', 'a'])
    expect(argv('rm a # note')).toEqual(['rm', 'a'])
    expect(argv("rm a '#b'")).toEqual(['rm', 'a', '#b'])
  })

  test('commandArgv strips wrappers behind a redirect', () => {
    expect(commandArgv('>/dev/null sudo -u root rm -rf a')).toEqual(['rm', '-rf', 'a'])
  })

  test('commandTokens strips assignments and flagged wrappers', () => {
    expect(commandTokens('FOO=1 BAR=2 node x.js')).toEqual(['node', 'x.js'])
    expect(commandTokens('sudo -E -u root cat f')).toEqual(['cat', 'f'])
    expect(commandTokens('timeout 5 sleep 1')).toEqual(['sleep', '1'])
    expect(commandTokens('FOO=1')).toEqual(['FOO=1'])
  })

  test('sudo and shell wrappers unwrap -c bodies and eval', () => {
    expect(splitCommand('sudo -u x sh -c "ls"')).toContain('ls')
    expect(splitCommand('eval "ls -la"')).toContain('ls -la')
  })
})

// The scan reads quotes, comments, heredocs and substitutions the way bash does.
describe('round 2: parser fidelity', () => {
  test('backtick pairing skips double quotes (item 6)', () => {
    expect(splitCommand('echo `echo "it\'s"` ; echo `rm -rf src`')).toContain('rm -rf src')
  })

  test('a nested backtick escaped inside backticks is a command', () => {
    expect(splitCommand('echo `echo \\`rm -rf src\\``')).toContain('rm -rf src')
  })

  test('heredoc delimiters get shell quote removal (item 4)', () => {
    for (const mark of ['\\EOF', "'E'OF", 'E\\OF', '"EO"F', "$'EOF'", "'EOF'", '"EOF"']) {
      const parts = splitCommand(`cat <<${mark}\nhello\nEOF\nrm -rf src`)
      expect(parts, mark).toContain('rm -rf src')
      expect(parts[0], mark).toContain('hello')
    }
  })

  test('<<-  strips tabs from the terminator only with the dash', () => {
    expect(splitCommand('cat <<-EOF\n\thi\n\tEOF\nrm -rf src')).toContain('rm -rf src')
    // without the dash a tab-indented EOF is not the terminator
    expect(splitCommand('cat <<EOF\n\tEOF\nrm -rf src\nEOF')).toEqual(['cat <<EOF\n\tEOF\nrm -rf src\nEOF'])
  })

  test('a heredoc that never ends is checked as commands too', () => {
    // (( 1 << 2 )) reads << as a heredoc mark with the delimiter 2
    const parts = splitCommand('(( 1 << 2 ))\nrm -rf src')
    expect(parts).toContain('rm -rf src')
    expect(splitCommand('cat <<NOPE\nrm -rf src')).toContain('rm -rf src')
  })

  test('an unquoted heredoc body runs its substitutions', () => {
    expect(splitCommand('cat <<EOF\n$(rm -rf src)\nEOF')).toContain('rm -rf src')
    expect(splitCommand('cat <<EOF\n`rm -rf src`\nEOF')).toContain('rm -rf src')
  })

  test('a quoted heredoc body is only text', () => {
    expect(splitCommand("cat <<'EOF'\n$(rm -rf src)\nEOF")).toEqual(["cat <<'EOF'\n$(rm -rf src)\nEOF"])
    expect(splitCommand('cat <<EOF\n\\$(rm -rf src)\nEOF')).toEqual(['cat <<EOF\n\\$(rm -rf src)\nEOF'])
  })

  test('a comment with a paren inside $( ) does not unbalance it (item 1)', () => {
    const cmd = 'echo $(echo a # (\n)\n'.repeat(12) + 'echo "$(rm -rf src)"'
    expect(splitCommand(cmd)).toContain('rm -rf src')
    expect(analyzeCommand(cmd).incomplete).toBe(false)
  })

  test('a comment with a quote inside $( ) hides nothing', () => {
    expect(splitCommand("echo $(echo a # it's\nrm -rf src) 'x'")).toContain('rm -rf src')
  })

  test('an unterminated substitution hands over the rest of the line', () => {
    expect(splitCommand('echo "$(echo a; rm -rf src')).toContain('rm -rf src')
    expect(splitCommand('echo `rm -rf src')).toContain('rm -rf src')
    expect(splitCommand('echo ${x:-$(rm -rf src')).toContain('rm -rf src')
  })

  test('the ) of a case pattern does not close the substitution', () => {
    expect(splitCommand('echo $(case x in x) rm -rf src;; esac)')).toContain('rm -rf src')
    expect(splitCommand('echo $(case x in (x) rm -rf src;; esac)')).toContain('rm -rf src')
  })

  test('an escaped space does not make a # a comment', () => {
    expect(splitCommand('echo \\ #x; rm -rf src')).toContain('rm -rf src')
    expect(splitCommand('echo a #x; rm -rf src')).toEqual(['echo a'])
  })

  test('# after a redirect operator starts a comment', () => {
    expect(splitCommand('echo a >#b')).toEqual(['echo a >'])
  })

  test('an ANSI-C string can hold an escaped quote', () => {
    expect(splitCommand("echo $'a\\'b'; rm -rf src; echo 'x'")).toContain('rm -rf src')
  })

  test('<< inside (( )) shifts and ends no heredoc', () => {
    expect(splitCommand('(( 1 << 2 ))\nrm -rf src\n2\n')).toContain('rm -rf src')
    expect(splitCommand('for (( i=0; i<1<<2; i++ )); do rm -rf src; done')).toContain('do rm -rf src')
    expect(splitCommand('x=$(( 1 << 2 ))\nrm -rf src\n2\n')).toContain('rm -rf src')
    // bash falls back to nested subshells when (( ) ) is not arithmetic
    expect(splitCommand('((rm -rf src); (echo))')).toContain('rm -rf src')
  })

  test('a backtick body ends at the first backtick that is not escaped', () => {
    expect(splitCommand("echo `echo 'a`; rm -rf src; echo `b'`")).toContain('rm -rf src')
    expect(splitCommand('echo `echo \\\\ #x; rm -rf src`')).toContain('rm -rf src')
    expect(splitCommand('echo `echo a # it\'s\nrm -rf src`')).toContain('rm -rf src')
  })

  test('process substitution is a body', () => {
    expect(splitCommand('cat <(rm -rf src)')).toContain('rm -rf src')
    expect(splitCommand('echo a >(rm -rf src)')).toContain('rm -rf src')
  })

  test('nesting past the cap reports incomplete (item 10)', () => {
    const level = (n: number): string => (n === 0 ? 'rm -rf src' : `echo "$(${level(n - 1)})"`)
    expect(analyzeCommand(level(3)).incomplete).toBe(false)
    expect(analyzeCommand(level(4)).incomplete).toBe(true)
    const dashC = (n: number): string => (n === 0 ? 'rm -rf src' : `bash -c '${dashC(n - 1).replace(/'/g, "'\\''")}'`)
    expect(analyzeCommand(dashC(2)).incomplete).toBe(false)
    expect(analyzeCommand(dashC(3)).incomplete).toBe(true)
  })

  test('a shell fed by a here-string, heredoc or echo reads that text (item 5)', () => {
    expect(splitCommand("bash <<<'rm -rf src'")).toContain('rm -rf src')
    expect(splitCommand('bash <<EOF\nrm -rf src\nEOF')).toContain('rm -rf src')
    expect(splitCommand("echo 'rm -rf src' | sh")).toContain('rm -rf src')
    expect(splitCommand("printf '%s\\n' 'rm -rf src' | sudo bash")).toContain('rm -rf src')
    expect(splitCommand('cat <<EOF | bash -s\nrm -rf src\nEOF')).toContain('rm -rf src')
    expect(splitCommand("eval \"$(echo 'rm -rf src')\"")).toContain('rm -rf src')
  })

  test('a shell that runs a script file is not fed by the pipe', () => {
    expect(splitCommand("echo 'rm -rf src' | bash script.sh")).toEqual(["echo 'rm -rf src'", 'bash script.sh'])
  })

  test('shellInvocation tells -c, script and stdin apart', () => {
    expect(shellInvocation("bash -lc 'ls'")).toEqual({ kind: 'body', body: 'ls' })
    expect(shellInvocation('eval ls -la')).toEqual({ kind: 'body', body: 'ls -la' })
    expect(shellInvocation("sh -c -- 'ls'")).toEqual({ kind: 'body', body: 'ls' })
    expect(shellInvocation('bash script.sh a')).toEqual({ kind: 'script', path: 'script.sh' })
    expect(shellInvocation('source <(curl x)')).toEqual({ kind: 'script', path: '<(curl x)' })
    expect(shellInvocation('bash')).toEqual({ kind: 'stdin' })
    expect(shellInvocation('sudo bash -s')).toEqual({ kind: 'stdin' })
    expect(shellInvocation('bash -')).toEqual({ kind: 'stdin' })
    expect(shellInvocation('ls -c')).toBeNull()
  })

  test('substitutionCommands lists the commands inside a word', () => {
    expect(substitutionCommands('$(curl -s x)')).toEqual(['curl -s x'])
    expect(substitutionCommands('<(curl -s x)')).toEqual(['curl -s x'])
    expect(substitutionCommands('plain')).toEqual([])
  })
})

describe('round 2: reserved words and groups (item 3)', () => {
  test('the command behind a reserved word is the head', () => {
    expect(commandArgv('then rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('do rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('else rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('elif rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('while rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('until rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('{ rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('! rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('! sudo -u x rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandArgv('then sudo rm -rf a')).toEqual(['rm', '-rf', 'a'])
    expect(commandTokens('{ ! cat .env')).toEqual(['cat', '.env'])
    expect(commandTokens('function f { rm -rf a')).toEqual(['rm', '-rf', 'a'])
  })

  test('a reserved word as an argument stays', () => {
    expect(commandArgv('echo then do {')).toEqual(['echo', 'then', 'do', '{'])
  })
})

describe('round 2: pipes into groups (X1)', () => {
  test('a subshell or brace group that reads a pipe is part of its pipeline', () => {
    expect(splitPipelines('curl x | (sh)')[0]).toEqual(['curl x', 'sh'])
    expect(splitPipelines('curl -s x | ( bash )')[0]).toEqual(['curl -s x', 'bash'])
    expect(splitPipelines('curl x | { sh; }')[0]).toContain('{ sh')
    expect(splitPipelines('wget -qO- x | (cd /tmp && sh)')[0]).toEqual(['wget -qO- x', 'cd /tmp', 'sh'])
    expect(splitPipelines('curl x | { cat; sh; }')[0]).toEqual(['curl x', '{ cat', 'sh'])
  })

  test('a group that feeds a pipe is its producer', () => {
    expect(splitPipelines('{ curl x; } | sh')).toContainEqual(['{ curl x', 'sh'])
    expect(splitPipelines('(curl x) | sh')).toContainEqual(['curl x', 'sh'])
    expect(splitPipelines('(cd /tmp && curl x) | sh')).toContainEqual(['cd /tmp', 'curl x', 'sh'])
  })

  test('a group that reads no pipe does not join the previous pipeline', () => {
    expect(splitPipelines('curl x; (sh)')).toEqual([['curl x'], ['sh']])
    expect(splitPipelines('(a; b) && (c)')).toEqual([['a'], ['b'], ['c']])
  })
})

describe('round 2: words (brace expansion, substitutions, ANSI-C)', () => {
  test('brace lists and sequences expand into words', () => {
    expect(tokens('{rm,-rf,src}')).toEqual(['rm', '-rf', 'src'])
    expect(tokens('r{m,} -rf src')).toEqual(['rm', 'r', '-rf', 'src'])
    expect(tokens('rm -{r,f} src')).toEqual(['rm', '-r', '-f', 'src'])
    expect(tokens('echo {1..3}')).toEqual(['echo', '1', '2', '3'])
    expect(tokens('echo {a..c}{1,2}')).toEqual(['echo', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2'])
    expect(tokens('echo dist/{..,x}/src')).toEqual(['echo', 'dist/../src', 'dist/x/src'])
  })

  test('quoted braces and plain ones stay', () => {
    expect(tokens("echo '{a,b}' \"{a,b}\" \\{a,b\\} {} {a} a{b ${x} git@{0}")).toEqual(['echo', '{a,b}', '{a,b}', '{a,b}', '{}', '{a}', 'a{b', '${x}', 'git@{0}'])
  })

  test('brace expansion cannot run away', () => {
    const t = Date.now()
    expect(tokens('echo ' + '{a,b}'.repeat(40)).length).toBeGreaterThan(0)
    expect(tokens('{' .repeat(100000)).length).toBe(1)
    expect(tokens('{a,'.repeat(5000) + '}'.repeat(5000)).length).toBeGreaterThan(0)
    expect(Date.now() - t).toBeLessThan(3000)
  })

  test('a substitution is one word', () => {
    expect(argv('eval $(curl -s x)')).toEqual(['eval', '$(curl -s x)'])
    expect(argv('bash <(curl -s x) y')).toEqual(['bash', '<(curl -s x)', 'y'])
    expect(argv('echo `a b` c')).toEqual(['echo', '`a b`', 'c'])
    expect(argv('echo "$(a "b c")" d')).toEqual(['echo', '$(a "b c")', 'd'])
  })

  test('ANSI-C strings decode', () => {
    expect(argv("$'\\x72m' -rf $'a\\nb' $'it\\'s'")).toEqual(['rm', '-rf', 'a\nb', "it's"])
    expect(argv("$'\\162m'")).toEqual(['rm'])
  })

  test('an unquoted $IFS splits a word, a quoted one does not', () => {
    expect(argv('rm${IFS}-rf${IFS}src')).toEqual(['rm', '-rf', 'src'])
    expect(argv('rm$IFS-rf$IFS\'src\'')).toEqual(['rm', '-rf', 'src'])
    expect(argv('echo "${IFS}" $IFSX')).toEqual(['echo', '${IFS}', '$IFSX'])
  })

  test('trap runs its first word as a command', () => {
    expect(shellInvocation('trap "rm -rf src" EXIT')).toEqual({ kind: 'body', body: 'rm -rf src' })
    expect(splitCommand('trap "rm -rf src" EXIT')).toContain('rm -rf src')
    expect(shellInvocation('trap - EXIT')).toBeNull()
    expect(shellInvocation('trap -p')).toBeNull()
    expect(shellInvocation('trap')).toBeNull()
  })

  test('a heredoc body is not an argument', () => {
    expect(argv('cat <<EOF\nrm -rf a\nEOF')).toEqual(['cat'])
  })
})

describe('round 2: linear time', () => {
  // Generous limits: the quadratic spellings these replace took tens of seconds.
  const timed = (name: string, cmd: string, limit = 5000) => {
    test(name, () => {
      const t = Date.now()
      splitCommand(cmd)
      tokens(cmd)
      expect(Date.now() - t).toBeLessThan(limit)
    })
  }
  timed('50000 unterminated $(', '$('.repeat(50000))
  timed('50000 unterminated "$(', 'echo "$('.repeat(50000))
  timed('100000 backticks', '`'.repeat(100000))
  timed('100000 unterminated ${', '${'.repeat(100000))
  timed('100000 nested $( closed', '$('.repeat(100000) + ')'.repeat(100000))
  timed('comments with parens inside $(', 'echo $(echo a # (\n)\n'.repeat(5000) + 'echo "$(rm -rf src)"')
  timed('20000 heredoc declarations without terminators', 'cat <<A\n'.repeat(20000))
  timed('20000 heredoc marks on one line', 'cat ' + '<<A '.repeat(20000))
  timed('100000 braces', '{'.repeat(100000))
  timed('50000 brace words', 'echo ' + '{a,b} '.repeat(50000))
  timed('100000 open parens', '('.repeat(100000))
  timed('100000 close parens', ')'.repeat(100000))
  timed('100000 pipes', 'a | '.repeat(100000) + 'sh')
  timed('5000 nested pipe groups', 'curl x | (sh | '.repeat(5000) + 'cat' + ')'.repeat(5000))
  timed('20000 echo into sh', "echo 'rm -rf a' | sh\n".repeat(20000))
  timed('20000 eval substitutions', 'eval "$(echo a)"\n'.repeat(20000))
  timed('20000 case words', '$(case x in '.repeat(20000))
  timed('30000 comments inside $(', '$(echo # \n'.repeat(30000))
  timed('50000 process substitutions', '<('.repeat(50000))
  timed('100000 ANSI-C openers', "$'".repeat(100000))
  timed('a million spaces', 'rm' + ' '.repeat(1000000) + '-rf x')
  timed('100000 backslash pairs in backticks', 'echo `' + '\\\\'.repeat(100000) + '`')
  timed('heredoc body with 50000 unterminated $(', 'cat <<EOF\n' + '$('.repeat(50000) + '\nEOF')
  timed('50000 ANSI-C escapes', "echo $'" + '\\x41\\n\\101'.repeat(50000) + "'")
  timed('a huge brace sequence', 'echo {1..999999999} {a..z}{1..9999}')
  timed('500 KB echoed into sh', "echo '" + 'a '.repeat(250000) + "' | sh")
  timed('50000 arithmetic commands', '(( 1 << 2 ))\n'.repeat(50000))
  timed('50000 unterminated (( ', '(('.repeat(50000))
})
