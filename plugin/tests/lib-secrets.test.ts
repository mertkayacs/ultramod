import { test, expect, describe } from 'claude-code/testing'
import { isSecretPath, bashReadsSecret, isEnvDump, redactSecrets } from '../hooks/lib/secrets'
import { splitCommand, commandTokens } from '../hooks/lib/shell'

describe('isSecretPath', () => {
  const SECRET: string[] = [
    '.env',
    '.env.local',
    '.env.production',
    '/project/.env',
    'config/.env',
    'server.pem',
    'certs/key.pem',
    'private.key',
    'id_rsa',
    'id_rsa_backup',
    'id_ed25519',
    'cert.p12',
    'cert.pfx',
    'keystore.jks',
    'my.keystore',
    '.npmrc',
    '.pypirc',
    '.netrc',
    '.git-credentials',
    '/home/u/.aws/credentials',
    '.aws/credentials',
    '/home/u/.docker/config.json',
    '/home/u/.kube/config',
    'service-credentials.json',
    'my-secret-config.json',
    'secrets.yaml',
    'secret.yml',
    '.ENV',
    'ID_RSA',
    '/root/.SSH/id_ed25519',
    '.aws/credentials.bak',
    '.docker/config.json.backup',
    '.kube/config.old',
  ]

  const NOT_SECRET: string[] = [
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.dist',
    'credentials.example.json',
    'id_rsa.pub',
    'id_ed25519.pub',
    'server.key.pub',
    'README.md',
    'package.json',
    'src/index.ts',
    'notary.json',
    'docs/secretRecipe.md',
    'secret.ts',
    'app.env.example',
    '.environment',
    'notes.txt',
  ]

  test('matches every secret path', () => {
    for (const p of SECRET) expect(isSecretPath(p)).toBe(true)
  })

  test('ignores every look-alike', () => {
    for (const p of NOT_SECRET) expect(isSecretPath(p)).toBe(false)
  })

  test('allow list spares exact paths and basenames', () => {
    expect(isSecretPath('config/.env.local', ['.env.local'])).toBe(false)
    expect(isSecretPath('config/.env.local', ['config/.env.local'])).toBe(false)
    expect(isSecretPath('other/.env.local', ['.env.local'])).toBe(false)
    expect(isSecretPath('other/.env', ['.env.local'])).toBe(true)
  })
})

describe('bashReadsSecret', () => {
  const READS: [string, string][] = [
    ['cat .env', '.env'],
    ['cat .env.local', '.env.local'],
    ['head -n 5 .env', '.env'],
    ['tail -f .env', '.env'],
    ['less ~/.aws/credentials', '~/.aws/credentials'],
    ['more .npmrc', '.npmrc'],
    ['bat .pypirc', '.pypirc'],
    ['grep TOKEN .env', '.env'],
    ["grep -A3 'password' .env", '.env'],
    ["rg 'secret' .env", '.env'],
    ["awk '{print $1}' .env", '.env'],
    ["sed -n '2p' .env", '.env'],
    ['cut -d= -f1 .env', '.env'],
    ['base64 .env', '.env'],
    ['base64 -w0 id_rsa', 'id_rsa'],
    ['xxd cert.p12', 'cert.p12'],
    ['od -c .netrc', '.netrc'],
    ['strings data.p12', 'data.p12'],
    ['sudo cat .env', '.env'],
    ['cd /tmp && cat .env', '.env'],
    ['cat .env | grep X', '.env'],
    ['cat < .env', '.env'],
    ['cat config/.docker/config.json', 'config/.docker/config.json'],
    ['cp .env /dev/stdout', '.env'],
    ['cp .env /dev/fd/1', '.env'],
    ['cp .env /proc/self/fd/1', '.env'],
    ['cat .env | tee /dev/stdout', '.env'],
    ['scp .env -', '.env'],
    ['zcat .env.gz', '.env.gz'],
    ['gzcat .env.gz', '.env.gz'],
    ['xzcat .env.xz', '.env.xz'],
    ['gunzip -c .env.gz', '.env.gz'],
    ['zstdcat .env.zst', '.env.zst'],
    ['openssl enc -d -aes-256-cbc -in .env.enc', '.env.enc'],
    ['base64 -d .env.b64', '.env.b64'],
    ['jq -r . .env', '.env'],
    ['perl -e "print <>" .env', '.env'],
    ['ruby -e "print File.read(ARGV[0])" .env', '.env'],
    ['node -e "console.log(require(\"fs\").readFileSync(process.argv[1], \"utf8\"))" .env', '.env'],
    ['node -e "const fs = require(\"fs\"); fs.readFileSync(\".env\")"', '.env'],
    ["python -c \"print(open('.env').read())\"", '.env'],
  ]

  const NO_READ: string[] = [
    'cat README.md',
    'source .env',
    '. .env',
    'cat .env.example',
    'cat .env > /tmp/out',
    'cat .env >> /tmp/out',
    "sed -i 's/a/b/' .env",
    'cp .env backup.env',
    'echo $TOKEN',
    'cat file.txt',
    'head package.json',
    'grep pattern src/*.ts',
    'cat > out.txt',
    'node --env-file .env server.js',
    'node --env-file=.env server.js',
    'docker compose --env-file .env up',
    'npx dotenv -e .env.local -- next dev',
    'bun --env-file=.env.local run dev',
    'deno run --env-file=.env main.ts',
  ]

  test('returns the path for every reading command', () => {
    for (const [cmd, want] of READS) {
      expect(bashReadsSecret(cmd), cmd).toBe(want)
    }
  })

  test('returns null for every look-alike', () => {
    for (const cmd of NO_READ) {
      expect(bashReadsSecret(cmd), cmd).toBe(null)
    }
  })

  test('stderr-only redirect still reads', () => {
    expect(bashReadsSecret('cat .env 2>/dev/null')).toBe('.env')
  })
})

describe('isEnvDump', () => {
  const DUMPS: string[] = ['env', 'printenv', 'set', 'export -p', 'export', 'env | sort', 'env FOO=1']
  const NOT_DUMPS: string[] = [
    'env FOO=1 node server.js',
    'printenv HOME',
    'set -e',
    'set -o pipefail',
    'export PATH=/usr/bin',
    'export FOO',
    'echo $PATH',
    'env -i sh',
  ]

  test('dumps are caught', () => {
    for (const cmd of DUMPS) expect(isEnvDump(cmd), cmd).toBe(true)
  })

  test('non-dumps pass', () => {
    for (const cmd of NOT_DUMPS) expect(isEnvDump(cmd), cmd).toBe(false)
  })
})

describe('redactSecrets', () => {
  test('redacts an Anthropic key', () => {
    // Split so secret scanners reading this repo do not flag the fake key.
    const r = redactSecrets('key sk-ant-' + 'api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01 end')
    expect(r.text).toBe('key [redacted:anthropic] end')
    expect(r.hits).toEqual([{ kind: 'anthropic', count: 1 }])
  })

  test('redacts OpenAI project and legacy keys', () => {
    const a = redactSecrets('a sk-' + 'proj-AbCdEf0123456789AbCdEf0123456789AbCdEf')
    expect(a.text).toContain('[redacted:openai]')
    const b = redactSecrets('b sk-' + 'AbCdEf0123456789AbCdEf0123456789AbCdEf0123')
    expect(b.text).toContain('[redacted:openai]')
    expect(a.hits.concat(b.hits).filter((h) => h.kind === 'openai')).toHaveLength(2)
  })

  test('redacts GitHub, GitLab, Slack, AWS, Google, Stripe, npm and HF tokens', () => {
    const samples: [string, string][] = [
      ['gh' + 'p_AbCdEf0123456789AbCdEf0123456789AbCdEf0123', 'github'],
      ['github' + '_pat_11AAAAAAA0aaaaaaaaaaaaaa_111111111111111111111111111111111111111111111111111111', 'github'],
      ['glpat' + '-AbCdEf0123456789AbCdEf01', 'gitlab'],
      ['xox' + 'b-123456789012-AbCdEf0123456789', 'slack'],
      ['AKIAIOSFODNN7EXAMPLE', 'aws'],
    ]
    for (const [tok, kind] of samples) {
      const r = redactSecrets('token ' + tok + ' end')
      expect(r.text, kind).not.toContain(tok)
      expect(r.hits.some((h) => h.kind === kind), kind).toBe(true)
    }
  })

  test('leaves near-miss prefixes alone', () => {
    const r = redactSecrets('the sk- prefix and AKIA and xoxb- alone and sk-short')
    expect(r.text).toBe('the sk- prefix and AKIA and xoxb- alone and sk-short')
    expect(r.hits).toEqual([])
  })

  test('redacts a private key block whole', () => {
    const r = redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAA\n-----END RSA PRIVATE KEY-----')
    expect(r.text).toBe('[redacted:private-key]')
    expect(r.hits).toEqual([{ kind: 'private-key', count: 1 }])
  })

  test('redacts a high entropy assignment', () => {
    const r = redactSecrets('password=Sup3rS3cretL0ngPassw0rdXy9Z')
    expect(r.text).toBe('password=[redacted:assignment]')
  })

  test('keeps placeholders and weak values', () => {
    const kept: string[] = [
      'password=changemechangemechange',
      'token=xxxxxxxxxxxxxxxxxxxx',
      'api_key=<token>',
      'secret=${MY_SECRET}',
      'password=$MY_PASSWORD',
      'token=12345678901234567890',
      'password=correcthorsebatterystaple',
    ]
    for (const s of kept) {
      expect(redactSecrets(s).text, s).toBe(s)
    }
  })

  test('counts hits by kind', () => {
    const r = redactSecrets(
      'a sk-' + 'ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01 b ' +
        'sk-' + 'ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf02 c'
    )
    expect(r.hits).toEqual([{ kind: 'anthropic', count: 2 }])
  })

  test('1 MB of text redacts in under 200 ms', () => {
    const line =
      '2026-10-07T12:00:00Z GET /api/items user_id=42 response=ok latency_ms=13 ordinary log line\n'
    const secretLine =
      'token=sk-' + 'ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf0 ghp' + '_AbCdEf0123456789AbCdEf0123456789AbCdEf0123\n'
    let big = ''
    while (big.length < 500_000) big += line
    big += secretLine
    while (big.length < 1_048_000) big += line
    big += '-----BEGIN RSA PRIVATE' + ' KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----'
    const t0 = Date.now()
    const r = redactSecrets(big)
    const ms = Date.now() - t0
    expect(r.text.length).toBeGreaterThan(1_000_000)
    expect(r.text).not.toContain('sk-ant-api03')
    expect(ms).toBeLessThan(200)
  })

  test('adversarial input has no catastrophic backtracking', () => {
    let evil = ''
    for (let i = 0; i < 3000; i++) {
      evil += '-----BEGIN RSA PRIVATE KEY----- never closed ' + i + ' sk-ant-short xoxb-short\n'
    }
    const t0 = Date.now()
    const r = redactSecrets(evil)
    expect(Date.now() - t0).toBeLessThan(200)
    // Round 2 (item 12): a BEGIN with no END is redacted to the end of its line run.
    expect(r.hits).toEqual([{ kind: 'private-key', count: 3000 }])
  })
})

describe('bashReadsSecret with a protected env file (C05)', () => {
  const LEAKS: string[] = [
    "node --env-file=.env -p 'process.env.API_KEY'",
    'node --env-file .env -e "console.log(process.env.API_KEY)"',
    "node --env-file=.env --print 'process.env.API_KEY'",
    'node --env-file=.env --eval "console.log(process.env.API_KEY)"',
    'node --env-file=.env --eval="console.log(process.env.API_KEY)"',
    "node --env-file=.env -pe 'process.env.API_KEY'",
    "node --env-file-if-exists=.env -p 'process.env.API_KEY'",
    "node --env-file=.env <<< 'console.log(process.env.API_KEY)'",
    "echo 'console.log(process.env.API_KEY)' | node --env-file=.env -",
    "cd app && node --env-file=config/.env.production -p 'process.env.API_KEY'",
    "bun --env-file=.env -e 'console.log(process.env.API_KEY)'",
    "deno eval --env-file=.env 'console.log(Deno.env.get(\"API_KEY\"))'",
  ]

  test('an inline or stdin script that loads a protected env file reads it', () => {
    for (const cmd of LEAKS) expect(bashReadsSecret(cmd), cmd).not.toBe(null)
  })

  test('the reported path is the env file', () => {
    expect(bashReadsSecret("node --env-file=.env -p 'process.env.API_KEY'")).toBe('.env')
    expect(bashReadsSecret('node --env-file .env.local -e "1"')).toBe('.env.local')
  })

  test('a sample env file or a script run stays allowed', () => {
    expect(bashReadsSecret("node --env-file=.env.example -p 'process.env.A'")).toBe(null)
    expect(bashReadsSecret('node --env-file=.env server.js')).toBe(null)
    expect(bashReadsSecret('node --env-file=.env --watch server.js')).toBe(null)
    expect(bashReadsSecret('node --env-file=.env -r ./setup.js server.js')).toBe(null)
    expect(bashReadsSecret('bun --env-file=.env.local run dev')).toBe(null)
    expect(bashReadsSecret('node --env-file=.env --test')).toBe(null)
    expect(bashReadsSecret('node --env-file=.env --run dev')).toBe(null)
  })

  test('printing without loading the file is not a read', () => {
    expect(bashReadsSecret("node -p 'process.env.HOME'")).toBe(null)
  })

  test('stdout redirected away is not a read', () => {
    expect(bashReadsSecret("node --env-file=.env -p 'process.env.A' > /tmp/out")).toBe(null)
  })

  test('a redirect that still lands in the Bash output is a read', () => {
    for (const cmd of [
      'cat .env > /dev/stderr',
      'cat .env >> /dev/stderr',
      'cat .env > /dev/stdout',
      'cat .env 1> /dev/fd/2',
      'cat .env &> /dev/stderr',
      'cat .env > /proc/self/fd/1',
      'cat .env > >(cat)',
      'cat > /dev/stderr .env',
    ]) expect(bashReadsSecret(cmd), cmd).toBe('.env')
  })

  test('the last stdout redirect decides where the output goes', () => {
    for (const cmd of [
      'cat .env > /dev/null > /dev/stderr',
      'cat .env > out.txt > /dev/stdout',
      'cat .env > out.txt >&2',
      'cat .env > out.txt 1>&2',
    ]) expect(bashReadsSecret(cmd), cmd).toBe('.env')
    for (const cmd of [
      'cat .env > /dev/stderr > out.txt',
      'cat .env > /dev/fd/2 >> backup.txt',
      'cat .env > out.txt 2>&1',
    ]) expect(bashReadsSecret(cmd), cmd).toBe(null)
  })

  test('a redirect to a real file is still not a read', () => {
    for (const cmd of ['cat .env > /tmp/out', 'cat .env >> backup.txt', 'cat .env 1> out.txt', 'cat .env &> all.log']) {
      expect(bashReadsSecret(cmd), cmd).toBe(null)
    }
  })
})

describe('bashReadsSecret honors the allow list (C10)', () => {
  test('a basename entry spares the same file under another folder', () => {
    expect(bashReadsSecret('cat /work/.env', ['.env'])).toBe(null)
    expect(bashReadsSecret('cat /work/.env', ['/work/.env'])).toBe(null)
  })

  test('only the allowed file is spared', () => {
    expect(bashReadsSecret('cat .env .npmrc', ['.env'])).toBe('.npmrc')
    expect(bashReadsSecret('cat .npmrc', ['.env'])).toBe('.npmrc')
  })

  test('an allowed env file spares the loading script', () => {
    expect(bashReadsSecret("node --env-file=.env -p 'process.env.A'", ['.env'])).toBe(null)
  })
})

describe('isEnvDump null-separated forms (C06)', () => {
  test('printenv and env with only formatting flags dump the environment', () => {
    for (const cmd of ['printenv --null', 'printenv -0', 'env -0', 'env --null', 'env | tr "\\0" "\\n"', 'printenv -0 | tr "\\0" "\\n"']) {
      expect(isEnvDump(cmd), cmd).toBe(true)
    }
  })

  test('a named variable is still not a dump', () => {
    for (const cmd of ['printenv -0 HOME', 'printenv --null HOME PATH', 'env -0 node server.js']) {
      expect(isEnvDump(cmd), cmd).toBe(false)
    }
  })
})

describe('redactSecrets stays linear on adversarial text (C07, G04)', () => {
  const LIMIT_MS = 500

  function timed(text: string): { ms: number; out: string } {
    const t0 = Date.now()
    const r = redactSecrets(text)
    return { ms: Date.now() - t0, out: r.text }
  }

  test('1 MB single token with no separator', () => {
    const { ms, out } = timed('a'.repeat(1_000_000))
    expect(out.length).toBe(1_000_000)
    expect(ms).toBeLessThan(LIMIT_MS)
  })

  test('1 MB run of identifier characters ending in a keyword', () => {
    const { ms } = timed('a_'.repeat(500_000) + 'token')
    expect(ms).toBeLessThan(LIMIT_MS)
  })

  test('1 MB of repeated keywords', () => {
    for (const unit of ['token', 'password', 'api_key', 'secret-', 'token=', 'secret: ']) {
      const { ms } = timed(unit.repeat(Math.ceil(1_000_000 / unit.length)))
      expect(ms, unit).toBeLessThan(LIMIT_MS)
    }
  })

  test('1 MB of spaces after a keyword', () => {
    const { ms } = timed('token' + ' '.repeat(1_000_000) + 'x')
    expect(ms).toBeLessThan(LIMIT_MS)
  })

  test('1 MB of unterminated key markers on one line', () => {
    for (const unit of ['-----END ', '-----BEGIN ', '-----BEGIN RSA PRIVATE' + ' KEY----- ', 'sk-ant-', 'github_pat_', 'AKIA']) {
      const { ms } = timed(unit.repeat(Math.ceil(1_000_000 / unit.length)))
      expect(ms, unit).toBeLessThan(LIMIT_MS)
    }
  })

  test('1 MB of END markers after an open key block', () => {
    const { ms } = timed('-----BEGIN RSA PRIVATE' + ' KEY-----\n' + '-----END '.repeat(111_000))
    expect(ms).toBeLessThan(LIMIT_MS)
  })

  test('a key block is still replaced whole after the rewrite', () => {
    const r = redactSecrets('a -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\ntail')
    expect(r.text).toBe('a [redacted:private-key]\ntail')
  })

  test('the assignment scan still redacts after the rewrite', () => {
    const value = 'Sup3rS3cretL0ngPassw0rdXy9Z'
    expect(redactSecrets(`MY_API_TOKEN: "${value}"`).text).toBe('MY_API_TOKEN=[redacted:assignment]"')
    expect(redactSecrets(`db-password = '${value}' next`).text).toBe("db-password=[redacted:assignment]' next")
    expect(redactSecrets(`SECRET_TOKEN=${value}\nPASSWORD=${value}`).text).toBe('SECRET_TOKEN=[redacted:assignment]\nPASSWORD=[redacted:assignment]')
    expect(redactSecrets(`Api-Key:${value}`).text).toBe('Api-Key=[redacted:assignment]')
    expect(redactSecrets(`tokenizer=${value}`).text).toBe(`tokenizer=${value}`)
  })
})

describe('bashReadsSecret input redirects (round 2, item 9)', () => {
  const READS: [string, string][] = [
    ['< .env cat', '.env'],
    ['<.env cat', '.env'],
    ['0< .env cat', '.env'],
    ['< .env head -n 3', '.env'],
    ['<.env sudo cat', '.env'],
    ['< ~/.ssh/id_rsa base64', '~/.ssh/id_rsa'],
    ['cat < .env', '.env'],
    ['cd /tmp && < .env cat', '.env'],
    ['while read l; do echo $l; done < .env', '.env'],
  ]
  for (const [cmd, path] of READS) {
    test(`flags ${cmd}`, () => {
      expect(bashReadsSecret(cmd)).toBe(path)
    })
  }

  const CLEAN = [
    '< input.txt cat',
    '<input.txt cat',
    '< .env.example cat',
    '< .env echo hi',
    '< .env cat > /tmp/x',
    'while read l; do echo $l; done < data.txt',
  ]
  for (const cmd of CLEAN) {
    test(`passes ${cmd}`, () => {
      expect(bashReadsSecret(cmd)).toBeNull()
    })
  }

  test('the allow list spares an allowed redirect source', () => {
    expect(bashReadsSecret('< .env cat', ['.env'])).toBeNull()
    expect(bashReadsSecret('< .env cat < id_rsa', ['.env'])).toBe('id_rsa')
  })
})

describe('bashReadsSecret globs (round 2, item 9)', () => {
  const READS: string[] = [
    'cat .env*',
    'cat .e*',
    'cat .en?',
    'cat .env.*',
    'cat .[e]nv',
    'cat .*',
    'cat .env.l*',
    'cat .NPM*',
    'cat ~/.ssh/id_*',
    'cat ~/.ssh/id_rsa*',
    'cat *.pem',
    'cat certs/*.key',
    'cat s*.pem',
    'cat server.p*',
    'cat ~/.aws/cred*',
    'cat ~/.aw*/credentials',
    'cat ~/.kube/c*',
    'cat *secret*',
    'cat cred*.json',
    'grep KEY .env*',
    'sudo cat .env*',
    'cat .env* | head',
    '< .e* cat',
  ]
  for (const cmd of READS) {
    test(`flags ${cmd}`, () => {
      expect(bashReadsSecret(cmd)).not.toBeNull()
    })
  }

  test('names the glob token', () => {
    expect(bashReadsSecret('cat .env*')).toBe('.env*')
  })

  const CLEAN = [
    'cat *',
    'cat ./*',
    'cat *.*',
    'cat ?',
    'cat *.json',
    'cat *.yaml',
    'cat package*.json',
    'cat src/*.ts',
    'cat README*',
    'cat .eslintrc*',
    'cat .env.example',
    'cat .git[i]gnore',
    'ls .env*',
    'echo .e*',
    'rm .env*',
    "sed 's/a*/b/' notes.txt",
    "grep 'a.*b' notes.txt",
    "awk '{ print $1 * 2 }' notes.txt",
    'cat ~/.ssh/known_hosts*',
    'cat ~/.ssh/*.pub',
    'cat .e* > /tmp/x',
  ]
  for (const cmd of CLEAN) {
    test(`passes ${cmd}`, () => {
      expect(bashReadsSecret(cmd)).toBeNull()
    })
  }

  test('the allow list spares only the files it names', () => {
    expect(bashReadsSecret('cat .env*', ['.env'])).toBe('.env*')
    expect(bashReadsSecret('cat .en?', ['.env'])).toBeNull()
  })

  test('glob matching stays fast on long and hostile tokens', () => {
    const cases = [
      'cat ' + '*'.repeat(200_000) + 'a',
      'cat ' + 'a*'.repeat(100_000) + 'b',
      'cat ' + '?*'.repeat(100_000) + '.pem',
      'cat ' + '[a'.repeat(100_000),
      'cat ' + '.e*'.repeat(100_000) + 'x',
      'cat ' + '*/'.repeat(100_000) + 'x',
      'cat ' + '.e* '.repeat(20_000),
    ]
    for (const cmd of cases) {
      const t0 = Date.now()
      bashReadsSecret(cmd)
      expect(Date.now() - t0, cmd.slice(0, 20)).toBeLessThan(1000)
    }
  })
})

describe('redactSecrets private keys without an END line (round 2, item 12)', () => {
  test('a truncated key is redacted to the end of its body', () => {
    const r = redactSecrets('out:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAu1x9mFq3Zc0yQeXW5kPj8LrTn2VhGd4sUo7bIiCw6YaRzE1M\nabcDEF+/=\n[output truncated]')
    expect(r.text).toBe('out:\n[redacted:private-key]\n[output truncated]')
    expect(r.hits).toEqual([{ kind: 'private-key', count: 1 }])
  })

  test('PEM header lines belong to the key', () => {
    const r = redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,ABCDEF\n\nMIIEowIBAAKCAQEAu1x9mFq3Zc0yQeXW5kPj8LrTn2VhGd4sUo7bIiCw6YaRzE1M\nnext line of prose')
    expect(r.text).toBe('[redacted:private-key]\nnext line of prose')
  })

  test('a lone BEGIN line and CRLF text are redacted', () => {
    expect(redactSecrets('-----BEGIN OPENSSH PRIVATE KEY-----').text).toBe('[redacted:private-key]')
    expect(redactSecrets('a\r\n-----BEGIN PRIVATE KEY-----\r\nMIIEowIBAAKCAQEAu1x9mFq3Zc0yQeXW5kPj8LrTn2VhGd4sUo7bIiCw6YaRzE1M\r\nabcd=\r\ntail').text).toBe('a\r\n[redacted:private-key]\r\ntail')
  })

  test('a key inside one JSON line loses the rest of that line', () => {
    const r = redactSecrets('{"key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADAN\\n"}\nnext')
    expect(r.text).toBe('{"key":"[redacted:private-key]\nnext')
  })

  test('a complete key still ends at its END line', () => {
    const r = redactSecrets('a -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\ntail')
    expect(r.text).toBe('a [redacted:private-key]\ntail')
  })

  test('only the unterminated key is cut when a closed key follows', () => {
    const r = redactSecrets('-----BEGIN PRIVATE' + ' KEY-----\nAAAA\n\ngap text\n-----BEGIN PRIVATE' + ' KEY-----\nBBBB\n-----END PRIVATE KEY-----\nz')
    expect(r.text).not.toContain('AAAA')
    expect(r.text).not.toContain('BBBB')
    expect(r.text.endsWith('\nz')).toBe(true)
  })

  test('1 MB of unterminated keys redacts in linear time', () => {
    const cases = [
      '-----BEGIN RSA PRIVATE KEY-----\n'.repeat(31_000),
      '-----BEGIN RSA PRIVATE KEY----- '.repeat(31_000),
      '-----BEGIN RSA PRIVATE KEY-----\n' + 'AAAA\n'.repeat(200_000),
      '-----BEGIN RSA PRIVATE KEY-----\n' + 'A'.repeat(1_000_000),
      '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: x\n'.repeat(25_000),
    ]
    for (const text of cases) {
      const t0 = Date.now()
      const r = redactSecrets(text)
      expect(Date.now() - t0).toBeLessThan(500)
      expect(r.text).toContain('[redacted:private-key]')
    }
  })
})

describe('redactSecrets AWS secret access keys (round 2, item 12)', () => {
  const KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'

  test('the environment and ini spellings are redacted', () => {
    expect(redactSecrets(`AWS_SECRET_ACCESS_KEY=${KEY}`).text).toBe('AWS_SECRET_ACCESS_KEY=[redacted:assignment]')
    expect(redactSecrets(`export AWS_SECRET_ACCESS_KEY="${KEY}"`).text).toBe('export AWS_SECRET_ACCESS_KEY=[redacted:assignment]"')
    expect(redactSecrets(`aws_secret_access_key = ${KEY}`).text).toBe('aws_secret_access_key=[redacted:assignment]')
    expect(redactSecrets(`secret-access-key: ${KEY}`).text).toBe('secret-access-key=[redacted:assignment]')
  })

  test('the JSON spelling is redacted', () => {
    expect(redactSecrets(`{"SecretAccessKey": "${KEY}"}`).text).toBe('{"SecretAccessKey=[redacted:assignment]"}')
  })

  test('the key and its AKIA partner both go', () => {
    const r = redactSecrets(`AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=${KEY}`)
    expect(r.text).toBe('AWS_ACCESS_KEY_ID=[redacted:aws]\nAWS_SECRET_ACCESS_KEY=[redacted:assignment]')
  })

  test('a short or placeholder value is kept', () => {
    expect(redactSecrets('AWS_SECRET_ACCESS_KEY=changeme').text).toBe('AWS_SECRET_ACCESS_KEY=changeme')
    expect(redactSecrets('AWS_SECRET_ACCESS_KEY=${SECRET}').text).toBe('AWS_SECRET_ACCESS_KEY=${SECRET}')
  })

  test('1 MB of the key name stays linear', () => {
    for (const unit of ['secret_access_key', 'secret_access_key=', 'secret-access-', 'secretaccesskey: ']) {
      const t0 = Date.now()
      redactSecrets(unit.repeat(Math.ceil(1_000_000 / unit.length)))
      expect(Date.now() - t0, unit).toBeLessThan(500)
    }
  })
})

describe('aitmpl review round (1.0.6)', () => {
  test('a glob is read as the names it spells, beyond the fixed list', () => {
    for (const [cmd, hit] of [
      ['cat client-cert.pem*', 'client-cert.pem*'],
      ['cat my-api.key*', 'my-api.key*'],
      ['cat certs/*.pem', 'certs/*.pem'],
      ['cat deploy-?.p12', 'deploy-?.p12'],
      ['head prod[0-9].key', 'prod[0-9].key'],
    ] as const) {
      expect(bashReadsSecret(cmd)).toBe(hit)
    }
    for (const cmd of ['cat *.env', 'cat *.pub', 'cat id_rsa*.pub', 'cat src/*.key.ts', 'cat *', 'cat *.*', 'cat notes*.md']) {
      expect(bashReadsSecret(cmd)).toBeNull()
    }
  })

  test('cp of a secret glob to stdout is a read', () => {
    expect(bashReadsSecret('cp .en* /dev/stdout')).toBe('.en*')
    expect(bashReadsSecret('cp *.pem -')).toBe('*.pem')
    expect(bashReadsSecret('cp *.pem backup/')).toBeNull()
  })

  test('env dumps are found behind wrappers and with any option', () => {
    for (const cmd of ['command env -0', 'command env', 'nice env -0', 'env -v', 'env -u HOME', 'env -0 -u HOME', 'env --null FOO=1']) {
      expect(isEnvDump(cmd)).toBe(true)
    }
    for (const cmd of ['env --help', 'env --version', 'command env -0 node server.js', 'env -v node app.js', "env -S 'node app.js'"]) {
      expect(isEnvDump(cmd)).toBe(false)
    }
  })
})

describe('aitmpl review round (1.0.6), second pass', () => {
  test('env -S options do not hide a secret read', () => {
    expect(bashReadsSecret("env -S '-i' cat .env")).toBe('.env')
  })

  test('env -i prints only the pairs it is given, so it is no dump', () => {
    for (const cmd of ['env -i', 'env -i FOO=1', 'env - FOO=1', 'env --ignore-environment', 'env -0i']) {
      expect(isEnvDump(cmd)).toBe(false)
    }
    expect(isEnvDump('env -uI')).toBe(true)
  })
})
