import { test, expect, describe } from 'claude-code/testing'
import { isTestPath, addedMarkers, assertionDrop, bashDeletesTests } from '../hooks/lib/testguard'

describe('isTestPath', () => {
  const TESTS: string[] = [
    'src/app.test.ts',
    'src/app.spec.tsx',
    'lib/parser.test.js',
    '__tests__/main.ts',
    'src/__tests__/util.ts',
    'tests/run.ts',
    'test/helper.ts',
    'src/tests/component.ts',
    'test_foo.py',
    'pkg/test_basics.py',
    'foo_test.py',
    'handler_test.go',
    'AppTest.java',
    'com/example/UserTests.java',
    'ServiceTests.cs',
    'user_spec.rb',
    'test.ts',
    'spec.ts',
    'foo_test.rs',
    'bar_test.cpp',
    'baz_test.cc',
    'test_qux.rs',
    'MyTest.kt',
    'MyTest.scala',
    'MyTest.groovy',
    'MyTest.swift',
    'MyTest.php',
  ]

  const NOT_TESTS: string[] = [
    'src/app.ts',
    'src/latest/util.ts',
    'src/contest/run.ts',
    'testing.md',
    'test.txt',
    'Test.java',
    'app.tests.ts',
    'README.md',
    'attest.py',
    'detest.go',
  ]

  test('matches test paths', () => {
    for (const p of TESTS) expect(isTestPath(p), p).toBe(true)
  })

  test('ignores look-alikes', () => {
    for (const p of NOT_TESTS) expect(isTestPath(p), p).toBe(false)
  })
})

describe('addedMarkers', () => {
  test('detects a new .skip(', () => {
    expect(addedMarkers('test("a", () => {})', 'test.skip("a", () => {})')).toEqual(['.skip('])
  })

  test('detects a new .only(', () => {
    expect(addedMarkers('it("a")', 'it.only("a")')).toEqual(['.only('])
  })

  test('detects xit( and xdescribe(', () => {
    expect(addedMarkers('it("a"); describe("b")', 'xit("a"); xdescribe("b")')).toEqual([
      'xit(',
      'xdescribe(',
    ])
  })

  test('detects python markers', () => {
    expect(addedMarkers('def test_a(): pass', '@pytest.mark.skip\ndef test_a(): pass')).toEqual([
      '@pytest.mark.skip',
    ])
    expect(addedMarkers('def test_a(): pass', '@pytest.mark.xfail\ndef test_a(): pass')).toEqual([
      '@pytest.mark.xfail',
    ])
    // skipif contains @pytest.mark.skip, and @unittest.skip( contains .skip(:
    // the edit is reported once, under the marker that names it.
    expect(addedMarkers('def test_a(): pass', '@pytest.mark.skipif(condition)\ndef test_a(): pass')).toEqual([
      '@pytest.mark.skipif',
    ])
    expect(addedMarkers('import unittest', 'import unittest\n@unittest.skip("x")\nclass T: pass')).toEqual([
      '@unittest.skip',
    ])
    // Both were genuinely added, so both are reported.
    expect(addedMarkers('def test_a(): pass', 'def test_a(): pass\n@unittest.skip("x")\n@unittest.skip("y")')).toEqual([
      '@unittest.skip',
    ])
    // One marker covers both calls, so it is reported once.
    expect(addedMarkers('test("a")', 'test("a"); test.skip("b"); it.skip("c")')).toEqual(['.skip('])
  })

  test('detects go, rust, java and ruby markers', () => {
    expect(addedMarkers('func TestA(t *testing.T) {}', 'func TestA(t *testing.T) { t.Skip("x") }')).toEqual([
      't.Skip(',
    ])
    expect(addedMarkers('#[test]\nfn a() {}', '#[test]\n#[ignore]\nfn a() {}')).toEqual(['#[ignore]'])
    expect(addedMarkers('@Test void a() {}', '@Disabled\n@Test void a() {}')).toEqual(['@Disabled'])
    expect(addedMarkers('@Test void a() {}', '@Ignore\n@Test void a() {}')).toEqual(['@Ignore'])
    expect(addedMarkers('@Test void a() {}', '@skip\n@Test void a() {}')).toEqual(['@skip'])
    expect(addedMarkers('it "a" do end', 'pending("todo")\nit "a" do end')).toEqual(['pending('])
  })

  test('no change gives nothing', () => {
    expect(addedMarkers('test.skip("a")', 'test.skip("a")')).toEqual([])
    expect(addedMarkers('it("a")', 'it("a")')).toEqual([])
  })

  test('removed markers are not added', () => {
    expect(addedMarkers('test.skip("a"); test.skip("b")', 'test.skip("a")')).toEqual([])
  })
})

describe('assertionDrop', () => {
  test('counts dropped expect calls', () => {
    expect(assertionDrop('expect(a).toBe(1)\nexpect(b).toBe(2)', 'expect(a).toBe(1)')).toBe(1)
  })

  test('counts assert and assertEquals', () => {
    expect(assertionDrop('assert(x); assertEquals(y, z)', 'assert(x)')).toBe(1)
  })

  test('counts should and require.', () => {
    expect(assertionDrop('x should equal 3', 'x is 3')).toBe(1)
    expect(assertionDrop('require.Equal(t, a, b)', 'a = b')).toBe(1)
  })

  test('no drop is 0', () => {
    expect(assertionDrop('expect(a)', 'expect(a)')).toBe(0)
    expect(assertionDrop('expect(a)', 'expect(a)\nexpect(b)')).toBe(0)
  })
})

describe('bashDeletesTests', () => {
  test('rm on a test file', () => {
    expect(bashDeletesTests('rm foo.test.ts')).toEqual(['foo.test.ts'])
  })

  test('rm of several, only test paths returned', () => {
    expect(bashDeletesTests('rm -rf src foo.test.ts README.md bar.spec.js')).toEqual([
      'foo.test.ts',
      'bar.spec.js',
    ])
  })

  test('git rm', () => {
    expect(bashDeletesTests('git rm foo.spec.ts')).toEqual(['foo.spec.ts'])
    expect(bashDeletesTests('git rm -f tests/')).toEqual(['tests/'])
  })

  test('unlink', () => {
    expect(bashDeletesTests('unlink pkg/foo_test.py')).toEqual(['pkg/foo_test.py'])
  })

  test('truncate -s 0', () => {
    expect(bashDeletesTests('truncate -s 0 app.test.ts')).toEqual(['app.test.ts'])
    expect(bashDeletesTests('truncate -s 100 app.test.ts')).toEqual([])
  })

  test('redirect that empties a test file', () => {
    expect(bashDeletesTests('echo x > app.test.ts')).toEqual(['app.test.ts'])
    expect(bashDeletesTests(': > app.test.ts')).toEqual(['app.test.ts'])
    expect(bashDeletesTests('echo x >> app.test.ts')).toEqual([])
  })

  test('compound commands are searched', () => {
    expect(bashDeletesTests('rm a.ts && rm b.test.ts')).toEqual(['b.test.ts'])
  })

  test('non-test deletions give nothing', () => {
    expect(bashDeletesTests('rm README.md')).toEqual([])
    expect(bashDeletesTests('rm -rf node_modules')).toEqual([])
  })
})
