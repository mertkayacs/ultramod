import { test, expect, describe } from 'claude-code/testing'
import { commandKind, claimsIn, exitProvesAll } from '../hooks/lib/claims'

describe('commandKind', () => {
  const CASES: [string, string | null][] = [
// test commands from the brief
  ['npm test', 'test'],
  ['npm run test', 'test'],
  ['npm run test:unit', 'test'],
  ['pnpm -r test', 'test'],
  ['yarn test', 'test'],
  ['npx vitest run', 'test'],
  ['npx jest', 'test'],
  ['python -m pytest', 'test'],
  ['uv run pytest', 'test'],
  ['go test ./...', 'test'],
  ['cargo test', 'test'],
  ['./gradlew test', 'test'],
  ['mvn -q test', 'test'],
  ['make check', 'test'],
  ['make test', 'test'],
  ['rspec spec/', 'test'],
  ['phpunit tests/', 'test'],
  ['deno test', 'test'],
  ['dotnet test', 'test'],
  ['./node_modules/.bin/vitest run', 'test'],
  ['pnpm exec vitest run', 'test'],
  ['pnpm exec -- vitest run', 'test'],
  ['pnpm dlx vitest run', 'test'],
  // a version pin on the tool is not part of its name
  ['npx vitest@3 run', 'test'],
  ['npx --yes jest@29', 'test'],
  ['bunx vitest@latest', 'test'],
  ['pnpm dlx vitest@3.2.4 run', 'test'],
  ['npx eslint@9 .', 'lint'],
  ['npx tsc@5.9.3 --noEmit', 'typecheck'],
  ['npm exec vitest@3', 'test'],
  // pnpm and bun run a bin by name, as yarn does
  ['pnpm vitest run', 'test'],
  ['bun vitest run', 'test'],
  ['yarn vitest run', 'test'],
  ['pnpm jest', 'test'],
  ['pnpm tsc --noEmit', 'typecheck'],
  ['bun eslint .', 'lint'],
  // npm run has an alias
  ['npm run-script test', 'test'],
  ['npm run-script build', 'build'],
  ['npm run-script lint', 'lint'],
  ['npm run-script typecheck', 'typecheck'],
  ['pnpm run-script test:unit', 'test'],
    // typecheck
    ['tsc --noEmit', 'typecheck'],
    ['tsc -p .', 'typecheck'],
    ['npm run typecheck', 'typecheck'],
    ['npm run type-check', 'typecheck'],
    ['npx tsc --noEmit', 'typecheck'],
    // build
    ['npm run build', 'build'],
    ['cargo build', 'build'],
    ['go build ./...', 'build'],
    // lint
    ['eslint .', 'lint'],
    ['ruff check', 'lint'],
    ['cargo clippy', 'lint'],
    ['npm run lint', 'lint'],
    ['golangci-lint run', 'lint'],
    ['go vet ./...', 'lint'],
    // not anything
    ['npm run dev', null],
    ['npm install', null],
    ['npm run publish', null],
    ['npm publish', null],
    ['npm test --help', null],
    ['vitest --help', null],
    ['echo hello', null],
    ['git status', null],
    ['make all', null],
    ['cargo fmt', null],
    ['python script.py', null],
    ['node server.js', null],
    ['npx create-react-app@latest app', null],
    ['npx prettier@3 --write .', null],
    ['npm run-script dev', null],
    ['pnpm install', null],
    ['pnpm add -D vitest', null],
    ['pnpm dev', null],
    ['bun install', null],
    ['bun run dev', null],
    ['pnpm vitest --help', null],
    // strongest kind wins
    ['npm run build && npm test', 'test'],
    ['tsc --noEmit && npm run build', 'typecheck'],
    ['npm run build && eslint .', 'build'],
    ['npm run build; git status', 'build'],
  ]

  for (const [cmd, want] of CASES) {
    test(`kind of ${cmd}`, () => {
      expect(commandKind(cmd)).toBe(want)
    })
  }
})

describe('claimsIn', () => {
  const POSITIVE: [string, string][] = [
    ['all tests pass', 'tests'],
    ['All tests pass.', 'tests'],
    ['tests are passing', 'tests'],
    ['tests now pass', 'tests'],
    ['the test suite passes', 'tests'],
    ['all 42 tests passed', 'tests'],
    ['every test passes', 'tests'],
    ['the tests passed after the fix', 'tests'],
    ['build succeeds', 'build'],
    ['the build succeeds', 'build'],
    ['builds cleanly', 'build'],
    ['the project builds cleanly', 'build'],
    ['the build passes', 'build'],
    ['build passed', 'build'],
    ['type check passes', 'typecheck'],
    ['the type check passes', 'typecheck'],
    ['no type errors', 'typecheck'],
    ['there are no type errors', 'typecheck'],
    ['typecheck passes', 'typecheck'],
    ['lint is clean', 'lint'],
    ['lint passes', 'lint'],
    ['linting is clean', 'lint'],
    ['no lint errors', 'lint'],
    ['all tests pass and the build succeeds', 'build'],
    ['the build is green', 'build'],
    ['tests are green', 'tests'],
    ['build is successful', 'build'],
    ['type checking is clean', 'typecheck'],
    ['all checks pass', 'tests'],
    ['ci passes', 'tests'],
    ['pipeline passed', 'tests'],
    ['a quick check shows all tests pass', 'tests'],
    ['I ran the check and all tests pass', 'tests'],
    ['the final check: all tests pass', 'tests'],
  ]

  const NEGATIVE: string[] = [
    'tests do not pass',
    'the tests are not passing',
    'if the tests pass',
    'once tests pass',
    'when the tests pass',
    'make sure the tests pass',
    'be sure the tests pass',
    'the tests should pass',
    'run the tests to confirm',
    'not all tests pass',
    'I hope the tests pass',
    'assuming the tests pass',
    'unless the build passes',
    'verify that the build passes',
    'the tests might pass',
    'if there are no type errors, ship it',
    'the tests haven\'t passed',
    'the tests hadn\'t passed',
    'the tests wouldn\'t pass',
    'the tests shouldn\'t pass',
    'the tests mustn\'t pass',
    'the tests needn\'t pass',
    'Check that all tests pass',
    'check that the build passes',
    'Please check that the type check passes',
    'double-check that lint is clean',
    'You may want to check that all tests pass before merging',
  ]

  test('positive phrases count', () => {
    for (const [answer, _kind] of POSITIVE) {
      const c = claimsIn(answer)
      expect(c.tests || c.build || c.typecheck || c.lint, answer).toBe(true)
    }
  })

  test('the right flag is set', () => {
    expect(claimsIn('all tests pass').tests).toBe(true)
    expect(claimsIn('build succeeds').build).toBe(true)
    expect(claimsIn('type check passes').typecheck).toBe(true)
    expect(claimsIn('lint is clean').lint).toBe(true)
    const multi = claimsIn('All tests pass, the build succeeds and lint is clean')
    expect(multi.tests && multi.build && multi.lint).toBe(true)
    expect(multi.typecheck).toBe(false)
  })

  test('negations and conditions never count', () => {
    for (const answer of NEGATIVE) {
      const c = claimsIn(answer)
      expect(c.tests || c.build || c.typecheck || c.lint, answer).toBe(false)
    }
  })

  test('plain statements make no claim', () => {
    const c = claimsIn('I refactored the parser and added two files.')
    expect(c.tests || c.build || c.typecheck || c.lint).toBe(false)
  })
})

describe('exitProvesAll', () => {
  const PROVES = [
    'npm test',
    'cd app && npm test',
    'npm run build && npm test',
    'npm test 2>&1',
    'npm test > out.log 2>&1',
    'npm test &> out.log',
    'npm test >&2',
    'FOO=1 npm test',
    '(cd app && npm test)',
    '[ -f package.json ] && npm test',
    'echo "a;b|c" && npm test',
    "echo 'a || b' && npm test",
    'npm test -- --grep "a || b"',
    'npm test -- -t foo\\|bar',
    'cd app &&   npm test\n',
    'npm run build \\\n  && npm test',
  ]
  const NOT = [
    'npm test || true',
    'npm test; echo done',
    'npm test | tail -20',
    'npm test 2>&1 | tail -20',
    'cd app && npm test | tee test.log',
    'npm test & wait',
    'npm test\necho done',
    'npm test && echo ok || echo bad',
    'npm test || exit 1',
    'echo $(npm test)',
    'echo `npm test`',
    'cat <<EOF\nnpm test\nEOF',
    "npm test 'unterminated",
    'npm test "unterminated',
    'npm test --reporter=a|b',
  ]
  for (const cmd of PROVES) {
    test(`a zero exit proves ${JSON.stringify(cmd)}`, () => {
      expect(exitProvesAll(cmd)).toBe(true)
    })
  }
  for (const cmd of NOT) {
    test(`a zero exit does not prove ${JSON.stringify(cmd)}`, () => {
      expect(exitProvesAll(cmd)).toBe(false)
    })
  }
})

describe('aitmpl review round (1.0.6)', () => {
  test('a negated test run is no test result', () => {
    for (const cmd of ['! npm test', 'if ! npm test; then echo broken; fi', '! pytest -q']) {
      expect(commandKind(cmd)).toBeNull()
    }
    expect(commandKind('npm test -- --grep "!slow"')).toBe('test')
    expect(commandKind('! npm test && npm run build')).toBe('build')
  })

  test('a zero exit does not vouch for a process substitution', () => {
    expect(exitProvesAll('cat <(npm test)')).toBe(false)
    expect(exitProvesAll('npm test > >(tee test.log)')).toBe(false)
    expect(exitProvesAll('npm test 2>&1')).toBe(true)
    expect(exitProvesAll('npm test -- --grep "<(x)"')).toBe(true)
  })
})
