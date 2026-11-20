import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deploy } from '../../scripts/deploy.mjs'

const id = '18ec3a67-49fa-4276-95f2-15108ca0e983'
const zero = '00000000-0000-0000-0000-000000000000'
let root: string
let databases: { name: string; uuid: string }[]
let calls: string[]
let fail: string
let staleBuild: boolean
let secretsPath: string | undefined
let uploadedSecrets: Record<string, string> | undefined
const source = () => join(root, 'wrangler.jsonc')
const built = () => join(root, 'dist/worker/wrangler.json')
const read = (path: string) => parse(readFileSync(path, 'utf8'))

function configure(binding: Record<string, string> = {}) {
  writeFileSync(source(), `{
    // Preserve deployment comments.
    "name": "app-gallery",
    "d1_databases": [{ "binding": "DB", "database_name": "my-gallery", ${Object.entries(binding).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)},`).join('')} }],
  }`)
}
const run = (command: string, args: string[]) => {
  const step = command === 'pnpm' ? 'build' : args[0] === 'deploy' ? 'publish' :
    args[1] === 'migrations' ? 'migrate' : args[1]
  calls.push(step)
  if (step === fail && step !== 'publish') throw new Error(`Simulated ${step} failure`)
  if (step === 'list') return JSON.stringify(databases)
  if (step === 'create') databases.push({ name: args[2], uuid: id })
  if (step === 'migrate') {
    expect(args).toEqual(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', source()])
    expect(read(source()).d1_databases[0].database_id).toBe(id)
  }
  if (step === 'execute') {
    expect(args.slice(0, 8)).toEqual(['d1', 'execute', 'DB', '--remote', '--config', source(), '--command', expect.any(String)])
    expect(args[7]).toContain('admin_credentials')
    expect(args[7]).toContain('api_tokens')
    expect(args[7]).toContain('LIMIT 0')
    const database = new DatabaseSync(':memory:')
    try {
      for (const name of readdirSync(new URL('../../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
        database.exec(readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), 'utf8'))
      }
      expect(database.prepare(args[7]).all()).toEqual([])
    } finally { database.close() }
  }
  if (step === 'build' && !staleBuild) {
    mkdirSync(join(root, 'dist/worker'), { recursive: true })
    writeFileSync(built(), JSON.stringify(read(source())))
  }
  if (step === 'publish') {
    expect(args.slice(0, 3)).toEqual(['deploy', '--config', built()])
    expect(read(built()).d1_databases[0].database_id).toBe(id)
    if (args.length > 3) {
      expect(args[3]).toBe('--secrets-file')
      secretsPath = args[4]
      uploadedSecrets = JSON.parse(readFileSync(secretsPath, 'utf8'))
      expect(statSync(secretsPath).mode & 0o777).toBe(0o600)
    }
    if (step === fail) throw new Error(`Simulated ${step} failure`)
  }
  return ''
}
const execute = (adminPassword = '') => deploy({ root, run, log: () => {}, adminPassword })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'app-gallery-deploy-'))
  databases = []
  calls = []
  fail = ''
  staleBuild = false
  secretsPath = undefined
  uploadedSecrets = undefined
  configure()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('D1 deployment orchestration', () => {
  it('creates the database before migrations, rebuilds, then publishes the resolved configuration', () => {
    execute()
    expect(calls).toEqual(['list', 'create', 'list', 'migrate', 'execute', 'build', 'publish'])
    expect(readFileSync(source(), 'utf8')).toContain('// Preserve deployment comments.')
  })
  it('reuses an existing database by its configured name', () => {
    databases = [{ name: 'my-gallery', uuid: id }]
    execute()
    expect(calls).toEqual(['list', 'migrate', 'execute', 'build', 'publish'])
  })
  it('repairs legacy all-zero IDs and does not publish stale Vite output', () => {
    configure({ database_id: zero })
    mkdirSync(join(root, 'dist/worker'), { recursive: true })
    writeFileSync(built(), JSON.stringify(read(source())))
    execute()
    expect(read(built()).d1_databases[0].database_id).toBe(id)
  })
  it('preserves explicit database IDs and avoids creating or listing resources', () => {
    configure({ database_id: id })
    execute()
    expect(calls).toEqual(['migrate', 'execute', 'build', 'publish'])
  })
  it('does not create a second database on subsequent deployments', () => {
    execute()
    calls = []
    execute()
    expect(calls).toEqual(['migrate', 'execute', 'build', 'publish'])
    expect(databases).toHaveLength(1)
  })
  it.each(['list', 'create', 'migrate', 'execute', 'build'])('stops on %s failure without publishing', step => {
    fail = step
    expect(execute).toThrow(`Simulated ${step} failure`)
    expect(calls).not.toContain('publish')
    if (step === 'list') expect(calls).not.toContain('create')
  })
  it('refuses to publish if the build still contains the placeholder ID', () => {
    configure({ database_id: zero })
    mkdirSync(join(root, 'dist/worker'), { recursive: true })
    writeFileSync(built(), JSON.stringify(read(source())))
    staleBuild = true
    expect(execute).toThrow('Refusing to publish a stale build')
    expect(calls).not.toContain('publish')
  })
  it('does not overwrite an invalid explicit ID with an unrelated database', () => {
    configure({ database_id: 'not-a-database-id' })
    expect(execute).toThrow('must be a real D1 database UUID')
    expect(calls).toEqual([])
  })
  it('does not create resources when the database-list response is invalid', () => {
    databases = [{ name: 'my-gallery', uuid: zero }]
    expect(execute).toThrow('Could not resolve D1 database')
    expect(calls).toEqual(['list'])
  })
  it('template has no fake database ID and uses the guarded deployment script', () => {
    const template = parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'))
    expect(template.d1_databases[0].database_id).toBeUndefined()
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.scripts.deploy).toBe('node scripts/deploy.mjs')
  })
  it('pnpm run deploy invokes the package script outside a workspace', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      private: true,
      scripts: { deploy: 'node -e "console.log(\'gallery-deploy-script-ran\')"' },
    }))
    const result = spawnSync('pnpm', ['run', 'deploy'], { cwd: root, encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('gallery-deploy-script-ran')
    for (const name of ['README.md', 'README.zh-CN.md']) {
      const readme = readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
      expect(readme).toContain('**`pnpm run deploy`**')
      expect(readme).not.toMatch(/^pnpm deploy$/m)
    }
  })
  it('uploads a build-time password as a runtime secret without adding it to config or command arguments', () => {
    const password = 'test-only-deploy-password'
    const logs: string[] = []
    deploy({ root, run, adminPassword: password, log: message => logs.push(message) })
    expect(uploadedSecrets).toEqual({ ADMIN_PASSWORD: password })
    expect(secretsPath).toBeDefined()
    expect(existsSync(secretsPath!)).toBe(false)
    expect(readFileSync(source(), 'utf8')).not.toContain(password)
    expect(readFileSync(built(), 'utf8')).not.toContain(password)
    expect(logs.join('\n')).not.toContain(password)
  })
  it('removes the temporary secret file even when publishing fails', () => {
    fail = 'publish'
    expect(() => execute('test-only-deploy-password')).toThrow('Simulated publish failure')
    expect(secretsPath).toBeDefined()
    expect(existsSync(secretsPath!)).toBe(false)
  })
  it('preserves runtime-only secrets when no build-time password is supplied', () => {
    execute()
    expect(secretsPath).toBeUndefined()
    expect(uploadedSecrets).toBeUndefined()
  })
  it.each(['short', ' '.repeat(16), 'x'.repeat(257)])('rejects invalid build passwords before changing cloud resources', password => {
    expect(() => execute(password)).toThrow('Build-time ADMIN_PASSWORD must contain 16-256 characters')
    expect(calls).toEqual([])
  })
})
