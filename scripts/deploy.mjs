import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { applyEdits, modify, parse } from 'jsonc-parser'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const placeholder = '00000000-0000-0000-0000-000000000000'
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))

function runCommand(command, args, { cwd, capture = false }) {
  const entry = command === 'wrangler' ? wrangler : process.env.npm_execpath
  const result = spawnSync(entry ? process.execPath : command, entry ? [entry, ...args] : args, {
    cwd, encoding: 'utf8', env: { ...process.env, CI: 'true' },
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed. Deployment stopped.`)
  return result.stdout || ''
}

function readConfig(path) {
  const text = readFileSync(path, 'utf8')
  const errors = []
  const config = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== 'object') throw new Error(`Invalid configuration: ${path}`)
  return { text, config }
}

function findDatabase(databases, name) {
  if (!Array.isArray(databases) || databases.some(db => !db || typeof db.name !== 'string' || !uuid.test(db.uuid))) {
    throw new Error('Wrangler returned an unexpected D1 database list. Deployment stopped.')
  }
  const matches = databases.filter(db => db.name === name)
  if (matches.length > 1) throw new Error(`Multiple D1 databases match ${name}. Set database_id explicitly.`)
  return matches[0]
}

export function deploy({ root = process.cwd(), run = runCommand, log = console.log } = {}) {
  const sourcePath = resolve(root, 'wrangler.jsonc')
  const builtPath = resolve(root, 'dist/worker/wrangler.json')
  let { text, config } = readConfig(sourcePath)
  const bindings = config.d1_databases
  if (!Array.isArray(bindings) || bindings.filter(db => db.binding === 'DB').length !== 1) {
    throw new Error('Configure exactly one D1 binding named DB in wrangler.jsonc.')
  }
  const index = bindings.findIndex(db => db.binding === 'DB')
  const binding = bindings[index]
  let databaseId = binding.database_id
  const execute = (command, args, capture = false) => run(command, args, { cwd: root, capture })
  const list = () => JSON.parse(execute('wrangler', ['d1', 'list', '--json', '--config', sourcePath], true))

  if (!databaseId || databaseId === placeholder) {
    const name = binding.database_name || (config.name && `${config.name}-db`)
    if (typeof name !== 'string' || !name.trim()) throw new Error('Set database_name or a Worker name before deploying.')
    log(`Resolving D1 binding DB (${name})...`)
    let database = findDatabase(list(), name)
    if (!database) {
      const args = ['d1', 'create', name, '--update-config=false', '--config', sourcePath]
      if (binding.jurisdiction) args.push('--jurisdiction', binding.jurisdiction)
      execute('wrangler', args)
      database = findDatabase(list(), name)
    }
    if (!database || database.uuid === placeholder) throw new Error(`Could not resolve D1 database ${name}. Deployment stopped.`)
    if (binding.jurisdiction && database.jurisdiction !== binding.jurisdiction) {
      throw new Error(`D1 database ${name} does not match the configured jurisdiction. Deployment stopped.`)
    }
    databaseId = database.uuid
    const options = { formattingOptions: { insertSpaces: true, tabSize: 2 } }
    text = applyEdits(text, modify(text, ['d1_databases', index, 'database_name'], name, options))
    text = applyEdits(text, modify(text, ['d1_databases', index, 'database_id'], databaseId, options))
    writeFileSync(sourcePath, text)
  }
  if (!uuid.test(databaseId) || databaseId === placeholder) throw new Error('DB database_id must be a real D1 database UUID.')

  log('Applying D1 migrations before publishing the Worker...')
  execute('wrangler', ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', sourcePath])
  // Vite embeds bindings in dist: rebuild after provisioning, never publish stale IDs.
  execute('pnpm', ['build'])
  config = readConfig(builtPath).config
  const builtBindings = config.d1_databases?.filter(db => db.binding === 'DB') || []
  if (builtBindings.length !== 1 || builtBindings[0].database_id !== databaseId) {
    throw new Error('Built DB binding does not match the resolved database. Refusing to publish a stale build.')
  }
  execute('wrangler', ['deploy', '--config', builtPath])
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { deploy() } catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment failed.')
    process.exitCode = 1
  }
}
