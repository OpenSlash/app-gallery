import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  if (step === fail) throw new Error(`Simulated ${step} failure`)
  if (step === 'list') return JSON.stringify(databases)
  if (step === 'create') databases.push({ name: args[2], uuid: id })
  if (step === 'migrate') {
    expect(args).toEqual(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', source()])
    expect(read(source()).d1_databases[0].database_id).toBe(id)
  }
  if (step === 'build' && !staleBuild) {
    mkdirSync(join(root, 'dist/worker'), { recursive: true })
    writeFileSync(built(), JSON.stringify(read(source())))
  }
  if (step === 'publish') {
    expect(args).toEqual(['deploy', '--config', built()])
    expect(read(built()).d1_databases[0].database_id).toBe(id)
  }
  return ''
}
const execute = () => deploy({ root, run, log: () => {} })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'app-gallery-deploy-'))
  databases = []
  calls = []
  fail = ''
  staleBuild = false
  configure()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('D1 deployment orchestration', () => {
  it('creates the database before migrations, rebuilds, then publishes the resolved configuration', () => {
    execute()
    expect(calls).toEqual(['list', 'create', 'list', 'migrate', 'build', 'publish'])
    expect(readFileSync(source(), 'utf8')).toContain('// Preserve deployment comments.')
  })
  it('reuses an existing database by its configured name', () => {
    databases = [{ name: 'my-gallery', uuid: id }]
    execute()
    expect(calls).toEqual(['list', 'migrate', 'build', 'publish'])
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
    expect(calls).toEqual(['migrate', 'build', 'publish'])
  })
  it('does not create a second database on subsequent deployments', () => {
    execute()
    calls = []
    execute()
    expect(calls).toEqual(['migrate', 'build', 'publish'])
    expect(databases).toHaveLength(1)
  })
  it.each(['list', 'create', 'migrate', 'build'])('stops on %s failure without publishing', step => {
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
})
