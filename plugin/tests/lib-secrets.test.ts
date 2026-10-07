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
    const r = redactSecrets('key sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01 end')
    expect(r.text).toBe('key [redacted:anthropic] end')
    expect(r.hits).toEqual([{ kind: 'anthropic', count: 1 }])
  })

  test('redacts OpenAI project and legacy keys', () => {
    const a = redactSecrets('a sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf')
    expect(a.text).toContain('[redacted:openai]')
    const b = redactSecrets('b sk-AbCdEf0123456789AbCdEf0123456789AbCdEf0123')
    expect(b.text).toContain('[redacted:openai]')
    expect(a.hits.concat(b.hits).filter((h) => h.kind === 'openai')).toHaveLength(2)
  })

  test('redacts GitHub, GitLab, Slack, AWS, Google, Stripe, npm and HF tokens', () => {
    const samples: [string, string][] = [
      ['gh' + 'p_AbCdEf0123456789AbCdEf0123456789AbCdEf0123', 'github'],
      ['github' + '_pat_11AAAAAAA0aaaaaaaaaaaaaa_111111111111111111111111111111111111111111111111111111', 'github'],
      ['glpat-AbCdEf0123456789AbCdEf01', 'gitlab'],
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
      'a sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf01 b ' +
        'sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf02 c'
    )
    expect(r.hits).toEqual([{ kind: 'anthropic', count: 2 }])
  })

  test('1 MB of text redacts in under 200 ms', () => {
    const line =
      '2026-10-07T12:00:00Z GET /api/items user_id=42 response=ok latency_ms=13 ordinary log line\n'
    const secretLine =
      'token=sk-ant-api03-AbCdEf0123456789AbCdEf0123456789AbCdEf0 ghp_AbCdEf0123456789AbCdEf0123456789AbCdEf0123\n'
    let big = ''
    while (big.length < 500_000) big += line
    big += secretLine
    while (big.length < 1_048_000) big += line
    big += '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----'
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
    expect(r.hits).toEqual([])
  })
})
