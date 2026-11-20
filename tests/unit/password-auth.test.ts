import { readFileSync } from 'node:fs'
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
  sqlite.exec(readFileSync(new URL('../../drizzle/0002_auth_sessions.sql', import.meta.url), 'utf8'))
  const DB = {
    prepare(sql: string) {
      let args: SQLInputValue[] = []
      return {
        bind(...values: SQLInputValue[]) { args = values; return this },
        async first() { return sqlite.prepare(sql).get(...args) ?? null },
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
      expect(await status.json()).toEqual({ configured: false, authenticated: false, localDev: false, configurationIssue })
    }
  })
  it('未登录或伪造旧 Access 头无法读取 API', async () => {
    const response = await request('/applications', { headers: { 'Cf-Access-Jwt-Assertion': 'fake' } })
    expect(response.status).toBe(401)
    expect(await (await request('/auth/session')).json()).toEqual({ configured: true, authenticated: false, localDev: false, configurationIssue: null })
  })
  it('恰好 16 位的密码能配置并登录，诊断不暴露密码或具体长度', async () => {
    env.ADMIN_PASSWORD = 'exactly16letters'
    expect(env.ADMIN_PASSWORD).toHaveLength(16)
    const response = await request('/auth/session')
    const status = await response.json() as Record<string, unknown>
    expect(status).toEqual({ configured: true, authenticated: false, localDev: false, configurationIssue: null })
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
    for (const path of ['/auth/login', '/auth/logout']) {
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
    expect((await request('/applications', {}, { LOCAL_DEV: 'true' })).status).toBe(503)
  })
  it('本地开发可绕过认证，但仍拒绝跨域写入', async () => {
    const status = await worker.request('http://localhost/api/v1/auth/session', {}, { LOCAL_DEV: 'true' })
    expect(await status.json()).toEqual({ configured: true, authenticated: true, localDev: true, configurationIssue: null })
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
