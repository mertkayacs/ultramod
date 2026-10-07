import { test, expect, describe } from 'claude-code/testing'
import { commandKind, claimsIn } from '../hooks/lib/claims'

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
