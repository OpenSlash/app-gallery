import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import worker from '../../src/worker/index'
import type { Env } from '../../src/worker/auth'

const origin = 'https://gallery.example.com'
const password = 'test-only-password-for-admin'
let sqlite: DatabaseSync
let env: Env
let limit: Mock<RateLimit['limit']>

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  for (const name of readdirSync(new URL('../../drizzle/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${name}`, import.meta.url), 'utf8'))
  }
  const DB = {
    prepare(sql: string) {
      let args: SQLInputValue[] = []
      return {
        bind(...values: SQLInputValue[]) { args = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this },
        async first() { return sqlite.prepare(sql).get(...args) ?? null },
        async all() { return { results: sqlite.prepare(sql).all(...args) } },
        async run() { return sqlite.prepare(sql).run(...args) },
      }
    },
    async batch(statements: { run: () => Promise<unknown> }[]) {
      return Promise.all(statements.map(statement => statement.run()))
    },
  } as unknown as D1Database
  limit = vi.fn(async () => ({ success: true }))
  env = { DB, ADMIN_PASSWORD: password, LOGIN_RATE_LIMITER: { limit } }
})
afterEach(() => sqlite.close())

function request(path: string, init: RequestInit = {}, bindings: Partial<Env> = env) {
  return worker.request(`${origin}/api/v1${path}`, init, bindings)
}
function post(path: string, body: unknown = {}, cookie?: string) {
  return request(path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}
async function login() {
  const response = await post('/auth/login', { password })
  expect(response.status).toBe(200)
  return response.headers.get('Set-Cookie')!.split(';')[0]
}

describe('管理员密码和会话', () => {
  it('未设置或密码过短时锁定 API，并提供公开设置状态', async () => {
    for (const [ADMIN_PASSWORD, configurationIssue] of [
      [undefined, 'missing'], ['', 'missing'], ['short', 'too_short'], [' '.repeat(20), 'too_short'], ['x'.repeat(257), 'too_long'],
    ] as const) {
      const bindings = { ...env, ADMIN_PASSWORD }
      const response = await request('/applications', {}, bindings)
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      const status = await request('/auth/session', {}, bindings)
      expect(await status.json()).toEqual({ configured: false, authenticated: false, localDev: false,
        configurationIssue, setupRequired: configurationIssue === 'missing' })
    }
  })
  it('未登录或伪造旧 Access 头无法读取 API', async () => {
    const response = await request('/applications', { headers: { 'Cf-Access-Jwt-Assertion': 'fake' } })
    expect(response.status).toBe(401)
    expect(await (await request('/auth/session')).json()).toEqual({ configured: true, authenticated: false, localDev: false, configurationIssue: null, setupRequired: false })
  })
  it('恰好 16 位的密码能配置并登录，诊断不暴露密码或具体长度', async () => {
    env.ADMIN_PASSWORD = 'exactly16letters'
    expect(env.ADMIN_PASSWORD).toHaveLength(16)
    const response = await request('/auth/session')
    const status = await response.json() as Record<string, unknown>
    expect(status).toEqual({ configured: true, authenticated: false, localDev: false, configurationIssue: null, setupRequired: false })
    expect(JSON.stringify(status)).not.toContain(env.ADMIN_PASSWORD)
    expect((await post('/auth/login', { password: env.ADMIN_PASSWORD })).status).toBe(200)
  })
  it('正确密码创建安全 Cookie，数据库不存原始令牌或密码', async () => {
    const response = await post('/auth/login', { password })
    const header = response.headers.get('Set-Cookie')!
    expect(header).toContain('__Host-gallery-session=')
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) {
      expect(header).toContain(attribute)
    }
    expect(header).not.toContain('Domain=')
    const cookie = header.split(';')[0]
    const status = await request('/auth/session', { headers: { Cookie: cookie } })
    expect((await status.json() as { authenticated: boolean }).authenticated).toBe(true)
    expect((await request('/missing', { headers: { Cookie: cookie } })).status).toBe(404)
    const stored = sqlite.prepare('SELECT * FROM auth_sessions').get()!
    expect(stored.token_hash).not.toBe(cookie.split('=')[1])
    expect(JSON.stringify(stored)).not.toContain(password)
  })
  it('错误、缺失或非字符串密码被拒绝且不创建会话', async () => {
    for (const input of [{ password: 'wrong' }, {}, { password: 123 }, null, { password: 'x'.repeat(257) }]) {
      expect((await post('/auth/login', input)).status).toBe(401)
    }
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()!.count).toBe(0)
  })
  it('限流返回 429；缺少限流绑定时不开放登录', async () => {
    limit.mockResolvedValue({ success: false })
    const response = await post('/auth/login', { password })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    env.LOGIN_RATE_LIMITER = undefined
    expect((await post('/auth/login', { password })).status).toBe(503)
  })
  it('篡改、过期、修改密码后的会话均失效', async () => {
    const cookie = await login()
    expect((await request('/missing', { headers: { Cookie: `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}` } })).status).toBe(401)
    env.ADMIN_PASSWORD = 'a-different-test-password'
    expect((await request('/missing', { headers: { Cookie: cookie } })).status).toBe(401)
    env.ADMIN_PASSWORD = password
    sqlite.prepare('UPDATE auth_sessions SET expires_at=0').run()
    expect((await request('/missing', { headers: { Cookie: cookie } })).status).toBe(401)
  })
  it('退出撤销服务器会话，重放旧 Cookie 也无法登录', async () => {
    const cookie = await login()
    const response = await post('/auth/logout', {}, cookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect((await request('/missing', { headers: { Cookie: cookie } })).status).toBe(401)
  })
  it('再次登录替换当前会话，而不是复用旧 Cookie', async () => {
    const old = await login()
    const response = await post('/auth/login', { password }, old)
    expect(response.headers.get('Set-Cookie')!.split(';')[0]).not.toBe(old)
    expect((await request('/missing', { headers: { Cookie: old } })).status).toBe(401)
  })
  it('登录和退出拒绝跨域、缺少 Origin 或非 JSON 请求', async () => {
    for (const path of ['/auth/setup', '/auth/login', '/auth/logout']) {
      for (const Origin of [undefined, 'https://evil.example.com']) {
        expect((await request(path, { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(Origin ? { Origin } : {}) }, body: '{}' })).status).toBe(403)
      }
      expect((await request(path, { method: 'POST', headers: { Origin: origin }, body: '{}' })).status).toBe(415)
    }
  })
  it('拒绝超大请求和生产域名的 HTTP 登录', async () => {
    expect((await post('/auth/login', { password: 'x'.repeat(17000) })).status).toBe(413)
    const response = await worker.request('http://gallery.example.com/api/v1/auth/login', {
      method: 'POST', headers: { Origin: 'http://gallery.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }, env)
    expect(response.status).toBe(400)
  })
  it('生产域名不能使用开发开关绕过登录', async () => {
    expect((await request('/applications', {}, { ...env, LOCAL_DEV: 'true' })).status).toBe(401)
    expect((await request('/applications', {}, { ...env, ADMIN_PASSWORD: undefined, LOCAL_DEV: 'true' })).status).toBe(503)
  })
  it('本地开发可绕过认证，但仍拒绝跨域写入', async () => {
    const status = await worker.request('http://localhost/api/v1/auth/session', {}, { LOCAL_DEV: 'true' })
    expect(await status.json()).toEqual({ configured: true, authenticated: true, localDev: true, configurationIssue: null, setupRequired: false })
    expect((await worker.request('http://localhost/api/v1/missing', {}, { LOCAL_DEV: 'true' })).status).toBe(404)
    const cross = await worker.request('http://127.0.0.1/api/v1/applications', {
      method: 'POST', headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' }, body: '{}',
    }, { LOCAL_DEV: 'true' })
    expect(cross.status).toBe(403)
  })
  it('可在 localhost 不启用绕过的情况下测试真实登录', async () => {
    const response = await worker.request('http://localhost/api/v1/auth/login', {
      method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }, env)
    expect(response.status).toBe(200)
    const cookie = response.headers.get('Set-Cookie')!
    expect(cookie).toMatch(/^gallery-session=/)
    expect(cookie).not.toContain('Secure')
  })
})

describe('首次部署设置密码', () => {
  beforeEach(() => { env.ADMIN_PASSWORD = undefined })
  const setup = (value = password, confirmPassword = value) =>
    post('/auth/setup', { password: value, confirmPassword })

  it('首次设置存储独立盐和哈希，不存明文；重启后仍可登录', async () => {
    expect((await (await request('/auth/session')).json() as { setupRequired: boolean }).setupRequired).toBe(true)
    expect((await request('/applications')).status).toBe(503)
    expect((await setup()).status).toBe(201)
    const stored = sqlite.prepare('SELECT * FROM admin_credentials').get()!
    expect(stored.password_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.salt).toMatch(/^[a-f0-9]{32}$/)
    expect(JSON.stringify(stored)).not.toContain(password)
    expect(stored.iterations).toBe(100_000)
    env = { ...env }
    const status = await (await request('/auth/session')).json()
    expect(status).toEqual({ configured: true, authenticated: false, localDev: false, configurationIssue: null, setupRequired: false })
    const cookie = await login()
    expect((await request('/missing', { headers: { Cookie: cookie } })).status).toBe(404)
    expect((await post('/auth/login', { password: 'wrong' })).status).toBe(401)
    expect((await post('/auth/logout', {}, cookie)).status).toBe(200)
    expect((await request('/missing', { headers: { Cookie: cookie } })).status).toBe(401)
  })
  it('拒绝不合法的密码、确认密码和超大请求', async () => {
    for (const value of [undefined, 123, null, 'short', ' '.repeat(16), 'x'.repeat(257)]) {
      expect((await post('/auth/setup', { password: value, confirmPassword: value })).status).toBe(400)
    }
    expect((await setup(password, 'different-password')).status).toBe(400)
    expect((await post('/auth/setup', null)).status).toBe(400)
    expect((await setup('x'.repeat(17000))).status).toBe(413)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_credentials').get()!.count).toBe(0)
  })
  it('重复初始化和并发初始化不能覆盖现有密码', async () => {
    const responses = await Promise.all([setup(), setup('another-valid-test-password')])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    const winner = responses[0].status === 201 ? password : 'another-valid-test-password'
    const stored = sqlite.prepare('SELECT * FROM admin_credentials').get()!
    expect((await setup('replacement-test-password')).status).toBe(409)
    expect(sqlite.prepare('SELECT * FROM admin_credentials').get()).toEqual(stored)
    expect((await post('/auth/login', { password: winner })).status).toBe(200)
    expect((await post('/auth/login', { password: 'replacement-test-password' })).status).toBe(401)
  })
  it('设置恰好 16 位的密码；相同密码重新初始化会使用不同盐', async () => {
    expect((await setup('exactly16letters')).status).toBe(201)
    const first = sqlite.prepare('SELECT * FROM admin_credentials').get()!
    expect((await post('/auth/login', { password: 'exactly16letters' })).status).toBe(200)
    sqlite.exec('DELETE FROM admin_credentials')
    expect((await setup('exactly16letters')).status).toBe(201)
    const second = sqlite.prepare('SELECT * FROM admin_credentials').get()!
    expect(first.salt).not.toBe(second.salt)
    expect(first.password_hash).not.toBe(second.password_hash)
  })
  it('初始化同样受限流和 HTTPS 约束', async () => {
    limit.mockResolvedValue({ success: false })
    expect((await setup()).status).toBe(429)
    env.LOGIN_RATE_LIMITER = undefined
    expect((await setup()).status).toBe(503)
    const response = await worker.request('http://gallery.example.com/api/v1/auth/setup', {
      method: 'POST', headers: { Origin: 'http://gallery.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, confirmPassword: password }),
    }, env)
    expect(response.status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_credentials').get()!.count).toBe(0)
  })
  it('D1 密码优先于旧 Secret；已有有效 Secret 时不开放初始化', async () => {
    env.ADMIN_PASSWORD = password
    expect((await setup()).status).toBe(409)
    env.ADMIN_PASSWORD = undefined
    await setup()
    const cookie = await login()
    env.ADMIN_PASSWORD = 'a-different-legacy-password'
    expect((await request('/missing', { headers: { Cookie: cookie } })).status).toBe(404)
    expect((await post('/auth/login', { password: env.ADMIN_PASSWORD })).status).toBe(401)
  })
  it('通过数据库重新初始化密码后，旧会话失效，即使新旧密码相同', async () => {
    await setup()
    const old = await login()
    sqlite.exec('DELETE FROM admin_credentials')
    await setup()
    expect((await request('/missing', { headers: { Cookie: old } })).status).toBe(401)
    const current = await login()
    expect((await request('/missing', { headers: { Cookie: current } })).status).toBe(404)
  })
})

describe('部署故障诊断', () => {
  it('缺少 D1 绑定时返回明确配置错误，不开放数据或设置接口', async () => {
    const bindings = { ADMIN_PASSWORD: password }
    for (const path of ['/auth/session', '/applications']) {
      const response = await request(path, {}, bindings)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: 'DB_BINDING_MISSING' })
    }
    const response = await request('/auth/setup', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
    }, bindings)
    expect(response.status).toBe(503)
  })
  it('旧数据库缺少凭据表时提示迁移，不返回 SQL 或数据库原始错误', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      sqlite.exec('DROP TABLE admin_credentials')
      const response = await request('/auth/session')
      expect(response.status).toBe(503)
      const body = await response.json() as { code: string; error: string; requestId: string }
      expect(body.code).toBe('DB_MIGRATIONS_REQUIRED')
      expect(body.error).toContain('pnpm run deploy')
      expect(body.error).not.toContain('SELECT')
      expect(log.mock.calls[0]).toContain(body.requestId)
    } finally { log.mockRestore() }
  })
  it('识别嵌套的 D1 缺字段错误，其他故障只返回关联错误编号', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prepare = vi.spyOn(env.DB, 'prepare')
    try {
      prepare.mockImplementation(() => { throw new Error('D1_ERROR', { cause: new Error('no such column: salt') }) })
      const response = await request('/auth/session')
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: 'DB_MIGRATIONS_REQUIRED' })
      prepare.mockImplementation(() => { throw new Error('private internal details') })
      const unknown = await request('/auth/session')
      expect(unknown.status).toBe(500)
      const body = await unknown.json() as { code: string; error: string; requestId: string }
      expect(body.code).toBe('INTERNAL_ERROR')
      expect(body.error).toContain(body.requestId)
      expect(body.error).not.toContain('private internal details')
    } finally { prepare.mockRestore(); log.mockRestore() }
  })
})

describe('应用读写 API Token', () => {
  async function issue(cookie?: string, input: unknown = { name: 'test integration', expiresInDays: 30 }) {
    const session = cookie ?? await login()
    const response = await post('/auth/tokens', input, session)
    expect(response.status).toBe(201)
    return await response.json() as { token: string; item: { id: string; prefix: string; expiresAt: number } }
  }
  function add(token: string, extraHeaders: Record<string, string> = {}, input: unknown = {
    name: 'from API', url: 'https://example.com', type: 'website', launchedOn: '2026-01-01',
  }) {
    return request('/applications', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(input),
    })
  }
  it('未登录不能创建、查看或撤销 Token；管理写入仍校验 Origin', async () => {
    expect((await request('/auth/tokens')).status).toBe(401)
    expect((await post('/auth/tokens', { name: 'unauthenticated' })).status).toBe(401)
    expect((await post('/auth/tokens/missing/revoke')).status).toBe(401)
    const cookie = await login()
    expect((await request('/auth/tokens', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"name":"unsafe"}',
    })).status).toBe(403)
  })
  it('明文只在创建时返回，D1 和列表只保存或展示非敏感字段', async () => {
    const cookie = await login()
    const { token, item } = await issue(cookie)
    expect(token).toMatch(/^ag_[a-f0-9]{64}$/)
    const stored = sqlite.prepare('SELECT * FROM api_tokens').get()!
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.token_prefix).toBe(item.prefix)
    expect(JSON.stringify(stored)).not.toContain(token)
    const response = await request('/auth/tokens', { headers: { Cookie: cookie } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json() as { items: Record<string, unknown>[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: item.id, scope: 'applications:write', invalidated: false })
    for (const field of ['token', 'token_hash', 'credential_tag']) expect(body.items[0]).not.toHaveProperty(field)
    expect(JSON.stringify(body)).not.toContain(token)
  })
  it('Bearer 无需浏览器 Cookie 或 Origin 即可添加应用，并记录来源和调用时间', async () => {
    const { token, item } = await issue()
    const response = await add(token)
    expect(response.status).toBe(201)
    const { id } = await response.json() as { id: string }
    expect(sqlite.prepare('SELECT name FROM applications WHERE id=?').get(id)!.name).toBe('from API')
    expect(sqlite.prepare('SELECT actor FROM events').get()!.actor).toBe(`api-token:${item.id}`)
    expect(sqlite.prepare('SELECT last_used_at FROM api_tokens').get()!.last_used_at).toBeTypeOf('number')
  })
  it('不允许 Token 读取目录、归档、修改生命周期、退出或管理 Token', async () => {
    const { token } = await issue()
    for (const [method, path] of [
      ['GET', '/applications'], ['GET', '/auth/tokens'], ['GET', '/auth/session'],
      ['POST', '/auth/tokens'], ['POST', '/auth/tokens/fake/revoke'], ['POST', '/auth/logout'],
      ['PUT', '/applications/fake'], ['POST', '/applications/fake/archive'],
      ['POST', '/deployments/fake/transitions'],
    ]) {
      const response = await request(path, { method, headers: {
        Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json',
      }, ...(method === 'GET' ? {} : { body: '{}' }) })
      expect(response.status, `${method} ${path}`).toBe(403)
    }
  })
  it('现有 Token 可读取单个应用及部分编辑，不覆盖未提供字段或生命周期', async () => {
    const { token } = await issue()
    const created = await add(token, {}, {
      name: 'original', url: 'https://example.com', type: 'service', launchedOn: '2026-01-01',
      description: 'keep description', category: 'API', tags: ['keep'], icon: 'cloud', color: 'blue', size: 'large', favorite: true,
    })
    const { id } = await created.json() as { id: string }
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const read = await request(`/applications/${id}`, { headers })
    expect(read.status).toBe(200)
    const { item } = await read.json() as { item: { revision: number } }
    const updated = await request(`/applications/${id}`, { method: 'PATCH', headers,
      body: JSON.stringify({ revision: item.revision, name: 'vm2api', url: 'http://example.com/console' }),
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({ ok: true, revision: 1 })
    expect(sqlite.prepare('SELECT name, icon, description, tags, color, size, favorite FROM applications WHERE id=?').get(id))
      .toMatchObject({ name: 'vm2api', icon: 'cloud', description: 'keep description', tags: '["keep"]', color: 'blue', size: 'large', favorite: 1 })
    expect(sqlite.prepare('SELECT url, status, launched_on FROM deployments WHERE application_id=?').get(id))
      .toMatchObject({ url: 'http://example.com/console', status: 'active', launched_on: '2026-01-01' })
    expect((await request(`/applications/${id}`, { method: 'PATCH', headers, body: '{"revision":0,"name":"stale"}' })).status).toBe(409)
    expect((await request(`/applications/${id}`, { method: 'PATCH', headers,
      body: '{"revision":1,"launchedOn":"2026-01-01"}' })).status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(1)
    for (const method of ['PUT', 'PATCH']) {
      expect((await request(`/applications/${id}`, { method, headers: { ...headers, Origin: 'https://evil.example.com' },
        body: '{"revision":1,"name":"cross-origin"}' })).status).toBe(403)
    }
    expect((await request(`/applications/${crypto.randomUUID()}`, { headers })).status).toBe(404)
  })
  it('Token 图标上传保存在 D1、去重并受保护读取，撤销后不能上传或编辑', async () => {
    const session = await login()
    const { token, item } = await issue(session)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'image/svg+xml' }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>'
    const upload = () => request('/icons', { method: 'POST', headers, body: svg })
    const response = await upload()
    expect(response.status).toBe(201)
    const { iconUrl } = await response.json() as { iconUrl: string }
    expect(await (await upload()).json()).toMatchObject({ iconUrl })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM uploaded_icons').get()?.n).toBe(1)
    expect((await request(iconUrl.replace('/api/v1', ''))).status).toBe(401)
    const image = await request(iconUrl.replace('/api/v1', ''), { headers: { Authorization: `Bearer ${token}` } })
    expect(image.status).toBe(200)
    expect(image.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(image.headers.get('Content-Security-Policy')).toContain("sandbox; default-src 'none'")
    expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await image.text()).toBe(svg)
    const created = await add(token, {}, { name: 'uploaded', url: 'https://example.com', type: 'app', iconUrl })
    expect(created.status).toBe(201)
    const { id } = await created.json() as { id: string }
    expect(sqlite.prepare('SELECT icon_url FROM applications WHERE id=?').get(id)?.icon_url).toBe(iconUrl)
    await post(`/auth/tokens/${item.id}/revoke`, {}, session)
    expect((await upload()).status).toBe(401)
    expect((await request(`/applications/${id}`, { method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{"revision":0,"name":"revoked"}' })).status).toBe(401)
  })
  it('拒绝图标跨域上传、过大文件、伪造图片及不存在的引用', async () => {
    const { token } = await issue()
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'image/svg+xml' }
    expect((await request('/icons', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example.com' }, body: '<svg/>' })).status).toBe(403)
    expect((await request('/icons', { method: 'POST', headers, body: 'x'.repeat(262145) })).status).toBe(413)
    expect((await request('/icons', { method: 'POST', headers, body: '<svg><script/></svg>' })).status).toBe(400)
    expect((await request('/icons', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/html' }, body: '<svg/>' })).status).toBe(415)
    expect((await add(token, {}, { name: 'missing icon', type: 'app', url: 'https://example.com',
      iconUrl: `/api/v1/icons/${crypto.randomUUID()}` })).status).toBe(400)
  })
  it('无效 Token 不回退到 Cookie 或本地开发身份；无认证仍要求同源', async () => {
    const cookie = await login()
    for (const token of ['bad', `ag_${'a'.repeat(64)}`]) {
      expect((await add(token, { Cookie: cookie, Origin: origin })).status).toBe(401)
    }
    const local = await worker.request('http://localhost/api/v1/applications', {
      method: 'POST', headers: { Authorization: 'Bearer bad', 'Content-Type': 'application/json' }, body: '{}',
    }, { ...env, LOCAL_DEV: 'true' })
    expect(local.status).toBe(401)
    expect((await request('/applications', { method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    })).status).toBe(403)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()!.count).toBe(0)
  })
  it('撤销、到期以及管理员密码变更均使 Token 失效', async () => {
    const cookie = await login()
    const first = await issue(cookie)
    expect((await post(`/auth/tokens/${first.item.id}/revoke`, {}, cookie)).status).toBe(200)
    expect((await post(`/auth/tokens/${first.item.id}/revoke`, {}, cookie)).status).toBe(200)
    expect((await add(first.token)).status).toBe(401)
    const expired = await issue(cookie)
    sqlite.prepare('UPDATE api_tokens SET expires_at=0 WHERE id=?').run(expired.item.id)
    expect((await add(expired.token)).status).toBe(401)
    const old = await issue(cookie)
    env.ADMIN_PASSWORD = 'a-different-admin-password'
    expect((await add(old.token)).status).toBe(401)
    const response = await post('/auth/login', { password: env.ADMIN_PASSWORD })
    const newCookie = response.headers.get('Set-Cookie')!.split(';')[0]
    const list = await (await request('/auth/tokens', { headers: { Cookie: newCookie } })).json() as {
      items: { id: string; invalidated: boolean }[]
    }
    expect(list.items.find(item => item.id === old.item.id)!.invalidated).toBe(true)
    expect((await post('/auth/tokens/missing/revoke', {}, newCookie)).status).toBe(404)
  })
  it('退出浏览器不会撤销独立 Token，但重新初始化 D1 密码会', async () => {
    env.ADMIN_PASSWORD = undefined
    expect((await post('/auth/setup', { password, confirmPassword: password })).status).toBe(201)
    const cookie = await login()
    const { token } = await issue(cookie)
    await post('/auth/logout', {}, cookie)
    expect((await add(token)).status).toBe(201)
    sqlite.exec('DELETE FROM admin_credentials')
    await post('/auth/setup', { password, confirmPassword: password })
    expect((await add(token)).status).toBe(401)
  })
  it('Token 调用仍要求 HTTPS、JSON、合法输入和请求大小限制', async () => {
    const { token } = await issue()
    expect((await add(token, { Origin: 'https://evil.example.com' })).status).toBe(403)
    expect((await add(token, { 'Content-Type': 'text/plain' })).status).toBe(415)
    expect((await add(token, {}, { name: 'bad', url: 'javascript:alert(1)', type: 'website' })).status).toBe(400)
    expect((await add(token, {}, { name: 'future', url: 'https://example.com', type: 'website', launchedOn: '2099-01-01' })).status).toBe(400)
    expect((await add(token, {}, { description: 'x'.repeat(17000) })).status).toBe(413)
    const http = await worker.request('http://gallery.example.com/api/v1/applications', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    }, env)
    expect(http.status).toBe(400)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM applications').get()!.count).toBe(0)
  })
  it('校验名称、有效期，原子限制 20 个有效 Token', async () => {
    const cookie = await login()
    for (const input of [{ name: ' ' }, { name: 'x'.repeat(81) }, { name: 'bad expiry', expiresInDays: 0 },
      { name: 'bad expiry', expiresInDays: 10000 }]) {
      expect((await post('/auth/tokens', input, cookie)).status).toBe(400)
    }
    for (let i = 0; i < 19; i++) await issue(cookie)
    const responses = await Promise.all([
      post('/auth/tokens', { name: 'concurrent A', expiresInDays: 7 }, cookie),
      post('/auth/tokens', { name: 'concurrent B', expiresInDays: 7 }, cookie),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM api_tokens').get()!.count).toBe(20)
    const row = sqlite.prepare('SELECT id FROM api_tokens LIMIT 1').get()!
    await post(`/auth/tokens/${row.id}/revoke`, {}, cookie)
    const { item } = await issue(cookie, { name: 'replacement', expiresInDays: 7 })
    expect(item.expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000)
  })
  it('大量历史 Token 不会挤掉仍可使用的 Token，保证可以从列表撤销', async () => {
    const cookie = await login()
    const { item } = await issue(cookie)
    const insert = sqlite.prepare(`INSERT INTO api_tokens
      (id, name, token_hash, token_prefix, credential_tag, created_at, expires_at, revoked_at)
      VALUES (?, 'old history', ?, 'ag_history', ?, ?, 0, 1)`)
    for (let i = 0; i < 105; i++) insert.run(`history-${i}`, `hash-${i}`, '0'.repeat(64), Date.now() + i)
    const response = await request('/auth/tokens', { headers: { Cookie: cookie } })
    const body = await response.json() as { items: { id: string }[] }
    expect(body.items).toHaveLength(100)
    expect(body.items[0].id).toBe(item.id)
  })
})
