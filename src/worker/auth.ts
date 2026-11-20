import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { passwordConfigurationIssue } from '../shared/auth'

export interface Env {
  DB: D1Database
  ADMIN_PASSWORD?: string
  LOGIN_RATE_LIMITER?: RateLimit
  LOCAL_DEV?: string
}
type AuthEnv = { Bindings: Env; Variables: { actor: string } }
type Session = { credential_tag: string; expires_at: number }
const lifetime = 12 * 60 * 60
const encoder = new TextEncoder()
const hex = (value: ArrayBuffer | Uint8Array) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const bytes = (value: string) => new Uint8Array(value.match(/../g)!.map(byte => parseInt(byte, 16)))
const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
const localHost = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
const localDev = (c: Context<AuthEnv>) => c.env.LOCAL_DEV === 'true' && localHost(new URL(c.req.url))
const configured = (env: Env) => passwordConfigurationIssue(env.ADMIN_PASSWORD) === null
const configurationError = (env: Env) => {
  switch (passwordConfigurationIssue(env.ADMIN_PASSWORD)) {
    case 'too_short': return 'Worker 已读取到 ADMIN_PASSWORD，但去除首尾空白后不足 16 位。'
    case 'too_long': return 'Worker 已读取到 ADMIN_PASSWORD，但长度超过 256 位。'
    default: return '当前运行的 Worker 未读取到 ADMIN_PASSWORD。请设置运行时 Secret 并部署，而不是仅设置构建变量。'
  }
}
const cookieName = (c: Context<AuthEnv>) => new URL(c.req.url).protocol === 'https:' ? '__Host-gallery-session' : 'gallery-session'
const cookieOptions = (c: Context<AuthEnv>) => ({
  path: '/', secure: new URL(c.req.url).protocol === 'https:', httpOnly: true, sameSite: 'Strict' as const,
})
const sessionToken = (c: Context<AuthEnv>) => {
  const token = getCookie(c, cookieName(c))
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined
}
const passwordKey = (password: string) => crypto.subtle.importKey(
  'raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
)

async function passwordMatches(expected: string, provided: string) {
  // Compare fixed-size MACs through Web Crypto instead of comparing secret strings.
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(expected))
  return crypto.subtle.verify('HMAC', key, mac, encoder.encode(provided))
}

async function authenticated(c: Context<AuthEnv>) {
  if (!configured(c.env)) return false
  const token = sessionToken(c)
  if (!token) return false
  const session = await c.env.DB.prepare('SELECT credential_tag, expires_at FROM auth_sessions WHERE token_hash=?')
    .bind(await digest(token)).first<Session>()
  if (!session || session.expires_at <= Date.now() || !/^[a-f0-9]{64}$/.test(session.credential_tag)) return false
  // Bind the session to the current password without storing a password hash.
  return crypto.subtle.verify('HMAC', await passwordKey(c.env.ADMIN_PASSWORD!),
    bytes(session.credential_tag), encoder.encode(token))
}

export const authentication = createMiddleware<AuthEnv>(async (c, next) => {
  const path = new URL(c.req.url).pathname
  if ((c.req.method === 'GET' && path === '/api/v1/auth/session') ||
      (c.req.method === 'POST' && ['/api/v1/auth/login', '/api/v1/auth/logout'].includes(path))) {
    return next()
  }
  if (localDev(c)) c.set('actor', 'local-developer')
  else {
    if (!configured(c.env)) return c.json({ error: configurationError(c.env) }, 503)
    if (!await authenticated(c)) return c.json({ error: '请先登录，或重新登录已过期的会话。' }, 401)
    c.set('actor', 'administrator')
  }
  await next()
})

export const authRoutes = new Hono<AuthEnv>()
authRoutes.get('/session', async c => c.json({
  configured: configured(c.env) || localDev(c),
  authenticated: localDev(c) || await authenticated(c),
  localDev: localDev(c),
  configurationIssue: localDev(c) ? null : passwordConfigurationIssue(c.env.ADMIN_PASSWORD),
}))

authRoutes.post('/login', async c => {
  if (!configured(c.env)) return c.json({ error: configurationError(c.env) }, 503)
  const url = new URL(c.req.url)
  if (url.protocol !== 'https:' && !localHost(url)) return c.json({ error: '登录必须使用 HTTPS。' }, 400)
  if (!c.env.LOGIN_RATE_LIMITER) return c.json({ error: '登录限流尚未配置，请检查 Worker 绑定。' }, 503)
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const { success } = await c.env.LOGIN_RATE_LIMITER.limit({ key: `${url.host}:login:${ip}` })
  if (!success) {
    c.header('Retry-After', '60')
    return c.json({ error: '登录尝试过于频繁，请稍后再试。' }, 429)
  }
  const input = await c.req.json()
  if (!input || typeof input.password !== 'string' || input.password.length > 256 ||
      !await passwordMatches(c.env.ADMIN_PASSWORD!, input.password)) {
    return c.json({ error: '密码不正确。' }, 401)
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)))
  const tag = hex(await crypto.subtle.sign('HMAC', await passwordKey(c.env.ADMIN_PASSWORD!), encoder.encode(token)))
  const old = sessionToken(c)
  const statements = [
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(Date.now()),
    c.env.DB.prepare('INSERT INTO auth_sessions (token_hash, credential_tag, expires_at) VALUES (?, ?, ?)')
      .bind(await digest(token), tag, Date.now() + lifetime * 1000),
  ]
  if (old) statements.push(c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(old)))
  await c.env.DB.batch(statements)
  setCookie(c, cookieName(c), token, { ...cookieOptions(c), maxAge: lifetime })
  return c.json({ ok: true })
})

authRoutes.post('/logout', async c => {
  const token = sessionToken(c)
  if (token) await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).run()
  deleteCookie(c, cookieName(c), cookieOptions(c))
  return c.json({ ok: true })
})
