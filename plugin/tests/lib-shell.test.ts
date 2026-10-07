import { test, expect, describe } from 'claude-code/testing'
import { splitCommand, tokens, normalize, baseName, commandTokens } from '../hooks/lib/shell'

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
