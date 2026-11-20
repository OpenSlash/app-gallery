import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { passwordConfigurationIssue } from '../shared/auth'
import { apiTokenInput, type ApiTokenSummary } from '../shared/api-tokens'

export interface Env {
  DB: D1Database
  ADMIN_PASSWORD?: string
  LOGIN_RATE_LIMITER?: RateLimit
  LOCAL_DEV?: string
}
type AuthEnv = { Bindings: Env; Variables: { actor: string } }
type Session = { credential_tag: string; expires_at: number }
type Credential = { sessionKey: string; verify: (password: string) => Promise<boolean> }
type StoredCredential = {
  password_hash: string; salt: string; iterations: number; session_secret: string
}
type StoredApiToken = {
  id: string; name: string; token_prefix: string; credential_tag: string
  created_at: number; expires_at: number; last_used_at: number | null; revoked_at: number | null
}
const lifetime = 12 * 60 * 60
const passwordIterations = 100_000
const encoder = new TextEncoder()
const hex = (value: ArrayBuffer | Uint8Array) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('')
const bytes = (value: string) => new Uint8Array(value.match(/../g)!.map(byte => parseInt(byte, 16)))
const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
const localHost = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
const localDev = (c: Context<AuthEnv>) => c.env.LOCAL_DEV === 'true' && localHost(new URL(c.req.url))
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

async function credentialTag(key: string, value: string) {
  return hex(await crypto.subtle.sign('HMAC', await passwordKey(key), encoder.encode(value)))
}

async function validCredentialTag(key: string, value: string, tag: string) {
  return /^[a-f0-9]{64}$/.test(tag) &&
    crypto.subtle.verify('HMAC', await passwordKey(key), bytes(tag), encoder.encode(value))
}

export const isTokenCreateRequest = (method: string, path: string) =>
  method === 'POST' && path === '/api/v1/applications'

async function passwordMatches(expected: string, provided: string) {
  // Compare fixed-size MACs through Web Crypto instead of comparing secret strings.
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(expected))
  return crypto.subtle.verify('HMAC', key, mac, encoder.encode(provided))
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations,
  }, key, 256))
}

async function credential(c: Context<AuthEnv>): Promise<Credential | null> {
  const stored = await c.env.DB.prepare(
    'SELECT password_hash, salt, iterations, session_secret FROM admin_credentials WHERE id=1',
  ).first<StoredCredential>()
  if (stored) return {
    sessionKey: stored.session_secret,
    verify: async password => passwordMatches(stored.password_hash,
      await derivePassword(password, bytes(stored.salt), stored.iterations)),
  }
  if (passwordConfigurationIssue(c.env.ADMIN_PASSWORD) === null) {
    const password = c.env.ADMIN_PASSWORD!
    return { sessionKey: password, verify: provided => passwordMatches(password, provided) }
  }
  return null
}

async function rateLimit(c: Context<AuthEnv>) {
  if (!c.env.LOGIN_RATE_LIMITER) return c.json({ error: '登录限流尚未配置，请检查 Worker 绑定。' }, 503)
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const { success } = await c.env.LOGIN_RATE_LIMITER.limit({ key: `${new URL(c.req.url).host}:login:${ip}` })
  if (!success) {
    c.header('Retry-After', '60')
    return c.json({ error: '操作过于频繁，请稍后再试。' }, 429)
  }
}

async function authenticated(c: Context<AuthEnv>, current: Credential | null) {
  if (!current) return false
  const token = sessionToken(c)
  if (!token) return false
  const session = await c.env.DB.prepare('SELECT credential_tag, expires_at FROM auth_sessions WHERE token_hash=?')
    .bind(await digest(token)).first<Session>()
  if (!session || session.expires_at <= Date.now() || !/^[a-f0-9]{64}$/.test(session.credential_tag)) return false
  // Replacing the active credential also invalidates sessions signed by its previous key.
  return crypto.subtle.verify('HMAC', await passwordKey(current.sessionKey),
    bytes(session.credential_tag), encoder.encode(token))
}

export const authentication = createMiddleware<AuthEnv>(async (c, next) => {
  const url = new URL(c.req.url)
  const path = url.pathname
  const authorization = c.req.header('Authorization')
  // A supplied credential is authoritative; never fall back to cookies or local bypass.
  if (authorization !== undefined) {
    if (!isTokenCreateRequest(c.req.method, path)) return c.json({ error: 'API Token 仅允许添加应用。' }, 403)
    if (url.protocol !== 'https:' && !localHost(url)) return c.json({ error: 'API Token 必须使用 HTTPS。' }, 400)
    const token = authorization.replace(/^Bearer /i, '')
    if (!/^Bearer /i.test(authorization) || !/^ag_[a-f0-9]{64}$/.test(token)) {
      return c.json({ error: 'API Token 无效或已失效。' }, 401)
    }
    const current = await credential(c)
    if (!current) return c.json({ error: '请先设置管理员密码。' }, 503)
    const now = Date.now()
    const stored = await c.env.DB.prepare(
      'SELECT id, credential_tag FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?',
    ).bind(await digest(token), now).first<{ id: string; credential_tag: string }>()
    if (!stored || !await validCredentialTag(current.sessionKey, `api-token:${stored.id}`, stored.credential_tag)) {
      return c.json({ error: 'API Token 无效或已失效。' }, 401)
    }
    const used = await c.env.DB.prepare(
      'UPDATE api_tokens SET last_used_at=? WHERE id=? AND revoked_at IS NULL AND expires_at>? RETURNING id',
    ).bind(now, stored.id, now).first<{ id: string }>()
    if (!used) return c.json({ error: 'API Token 无效或已失效。' }, 401)
    c.set('actor', `api-token:${stored.id}`)
    await next()
    return
  }
  if ((c.req.method === 'GET' && path === '/api/v1/auth/session') ||
      (c.req.method === 'POST' && ['/api/v1/auth/setup', '/api/v1/auth/login', '/api/v1/auth/logout'].includes(path))) {
    return next()
  }
  if (localDev(c)) c.set('actor', 'local-developer')
  else {
    const current = await credential(c)
    if (!current) return c.json({ error: '请先在首页设置管理员密码。' }, 503)
    if (!await authenticated(c, current)) return c.json({ error: '请先登录，或重新登录已过期的会话。' }, 401)
    c.set('actor', 'administrator')
  }
  await next()
})

export const authRoutes = new Hono<AuthEnv>()
authRoutes.get('/session', async c => {
  if (localDev(c)) return c.json({
    configured: true, authenticated: true, localDev: true, configurationIssue: null, setupRequired: false,
  })
  const current = await credential(c)
  return c.json({
    configured: Boolean(current),
    authenticated: await authenticated(c, current),
    localDev: false,
    configurationIssue: current ? null : passwordConfigurationIssue(c.env.ADMIN_PASSWORD),
    setupRequired: !current && passwordConfigurationIssue(c.env.ADMIN_PASSWORD) === 'missing',
  })
})

authRoutes.post('/setup', async c => {
  const url = new URL(c.req.url)
  if (url.protocol !== 'https:' && !localHost(url)) return c.json({ error: '设置密码必须使用 HTTPS。' }, 400)
  const limited = await rateLimit(c)
  if (limited) return limited
  if (await credential(c)) return c.json({ error: '管理员密码已设置，请直接登录。' }, 409)
  if (passwordConfigurationIssue(c.env.ADMIN_PASSWORD) !== 'missing') {
    return c.json({ error: configurationError(c.env) }, 503)
  }
  const input = await c.req.json()
  if (passwordConfigurationIssue(input?.password) !== null) {
    return c.json({ error: '请使用 16 至 256 位的密码，去除首尾空白后至少 16 位。' }, 400)
  }
  if (input.password !== input.confirmPassword) return c.json({ error: '两次输入的密码不一致。' }, 400)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePassword(input.password, salt, passwordIterations)
  // The singleton primary key makes first-run setup atomic across requests and Worker instances.
  const inserted = await c.env.DB.prepare(`
    INSERT INTO admin_credentials (id, password_hash, salt, iterations, session_secret, created_at)
    VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id
  `).bind(hash, hex(salt), passwordIterations, hex(crypto.getRandomValues(new Uint8Array(32))), Date.now())
    .first<{ id: number }>()
  if (!inserted) return c.json({ error: '管理员密码已设置，请直接登录。' }, 409)
  return c.json({ ok: true }, 201)
})

authRoutes.post('/login', async c => {
  const current = await credential(c)
  if (!current) return c.json({ error: '请先在首页设置管理员密码。' }, 503)
  const url = new URL(c.req.url)
  if (url.protocol !== 'https:' && !localHost(url)) return c.json({ error: '登录必须使用 HTTPS。' }, 400)
  const limited = await rateLimit(c)
  if (limited) return limited
  const input = await c.req.json()
  if (!input || typeof input.password !== 'string' || input.password.length > 256 ||
      !await current.verify(input.password)) {
    return c.json({ error: '密码不正确。' }, 401)
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)))
  const tag = hex(await crypto.subtle.sign('HMAC', await passwordKey(current.sessionKey), encoder.encode(token)))
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

authRoutes.get('/tokens', async c => {
  const current = await credential(c)
  if (!current) return c.json({ error: '请先设置真实管理员密码，再管理 API Token。' }, 503)
  const rows = await c.env.DB.prepare(`
    SELECT id, name, token_prefix, credential_tag, created_at, expires_at, last_used_at, revoked_at
    FROM api_tokens
    ORDER BY CASE WHEN revoked_at IS NULL AND expires_at>? THEN 0 ELSE 1 END, created_at DESC, id DESC
    LIMIT 100
  `).bind(Date.now()).all<StoredApiToken>()
  const items: ApiTokenSummary[] = await Promise.all(rows.results.map(async row => ({
    id: row.id, name: row.name, prefix: row.token_prefix, scope: 'applications:create' as const,
    createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at,
    invalidated: !await validCredentialTag(current.sessionKey, `api-token:${row.id}`, row.credential_tag),
  })))
  return c.json({ items })
})

authRoutes.post('/tokens', async c => {
  const url = new URL(c.req.url)
  if (url.protocol !== 'https:' && !localHost(url)) return c.json({ error: '创建 API Token 必须使用 HTTPS。' }, 400)
  const current = await credential(c)
  if (!current) return c.json({ error: '请先设置真实管理员密码，再创建 API Token。' }, 503)
  const input = apiTokenInput.parse(await c.req.json())
  const now = Date.now()
  const id = crypto.randomUUID()
  const token = `ag_${hex(crypto.getRandomValues(new Uint8Array(32)))}`
  const expiresAt = now + input.expiresInDays * 86_400_000
  const tag = await credentialTag(current.sessionKey, `api-token:${id}`)
  // Keep the active-token quota atomic, including when multiple administrators create tokens.
  const inserted = await c.env.DB.prepare(`
    INSERT INTO api_tokens (id, name, token_hash, token_prefix, credential_tag, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM api_tokens WHERE revoked_at IS NULL AND expires_at>?) < 20
    RETURNING id
  `).bind(id, input.name, await digest(token), token.slice(0, 11), tag, now, expiresAt, now).first<{ id: string }>()
  if (!inserted) return c.json({ error: '最多保留 20 个未过期且未撤销的 Token，请先撤销旧 Token。' }, 409)
  return c.json({ token, item: {
    id, name: input.name, prefix: token.slice(0, 11), scope: 'applications:create',
    createdAt: now, expiresAt, lastUsedAt: null, revokedAt: null, invalidated: false,
  } satisfies ApiTokenSummary }, 201)
})

authRoutes.post('/tokens/:id/revoke', async c => {
  const result = await c.env.DB.prepare(
    'UPDATE api_tokens SET revoked_at=COALESCE(revoked_at, ?) WHERE id=? RETURNING id',
  ).bind(Date.now(), c.req.param('id')).first<{ id: string }>()
  if (!result) return c.json({ error: 'Token 不存在。' }, 404)
  return c.json({ ok: true })
})
