import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { applications } from './db/schema'
import { appInput, nextStatus, transitionInput, updateInput, utcDateStart, type AppRecord, type HistoryEvent, type Status } from '../shared/model'
import { authentication, authRoutes, isTokenCreateRequest, type Env } from './auth'

const app = new Hono<{ Bindings: Env; Variables: { actor: string } }>()

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  const url = new URL(c.req.url)
  if (!['GET', 'HEAD'].includes(c.req.method)) {
    const origin = c.req.header('Origin')
    const tokenRequest = origin === undefined && c.req.header('Authorization') !== undefined &&
      isTokenCreateRequest(c.req.method, url.pathname)
    if (origin !== url.origin && !tokenRequest) return c.json({ error: '请求来源不被允许。' }, 403)
    if (!c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: '请使用 JSON 请求。' }, 415)
    const length = Number(c.req.header('Content-Length') ?? 0)
    if (length > 16_384) return c.json({ error: '请求内容过大。' }, 413)
    const body = await c.req.text()
    if (new TextEncoder().encode(body).length > 16_384) return c.json({ error: '请求内容过大。' }, 413)
  }
  await next()
})
app.use('/api/*', async (c, next) => {
  if (!(c.env.LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) &&
    typeof c.env.DB?.prepare !== 'function') {
    return c.json({
      code: 'DB_BINDING_MISSING',
      error: '当前 Worker 未绑定 D1 数据库。请检查绑定名称为 DB，并使用 pnpm run deploy 完成部署。',
    }, 503)
  }
  await next()
})
app.use('/api/*', authentication)
app.route('/api/v1/auth', authRoutes)

app.get('/api/v1/applications', async c => {
  const now = Date.now()
  const result = await c.env.DB.prepare(`
    SELECT a.*, d.id AS deployment_id, d.url, d.launched_on, d.retired_at, d.status, d.revision,
      COALESCE((SELECT SUM(COALESCE(p.ended_at, ?) - p.started_at)
        FROM lifecycle_periods p WHERE p.deployment_id = d.id), 0) AS active_ms
    FROM applications a JOIN deployments d ON d.application_id = a.id
    WHERE a.archived = 0 ORDER BY a.created_at DESC
  `).bind(now).all<Record<string, unknown>>()
  const items = result.results.map(row => ({
    id: row.id, deploymentId: row.deployment_id, name: row.name, description: row.description,
    type: row.type, category: row.category, tags: JSON.parse(row.tags as string), icon: row.icon,
    color: row.color, size: row.size, favorite: Boolean(row.favorite), archived: Boolean(row.archived),
    createdAt: row.created_at, url: row.url, launchedOn: row.launched_on, retiredAt: row.retired_at,
    status: row.status, revision: row.revision, activeMs: row.active_ms,
  } as AppRecord))
  return c.json({ items, asOf: now })
})

app.post('/api/v1/applications', async c => {
  const input = appInput.parse(await c.req.json())
  const now = Date.now()
  const started = input.launchedOn ? utcDateStart(input.launchedOn) : null
  if (started !== null && started > now) return c.json({ error: '上线日期不能在未来。' }, 400)
  const id = crypto.randomUUID()
  const deploymentId = crypto.randomUUID()
  const { url, launchedOn, ...metadata } = input
  const db = drizzle(c.env.DB)
  const insert = db.insert(applications).values({ ...metadata, id, archived: false, createdAt: now }).toSQL()
  const statements = [
    c.env.DB.prepare(insert.sql).bind(...insert.params),
    c.env.DB.prepare('INSERT INTO deployments (id, application_id, url, launched_on, status) VALUES (?, ?, ?, ?, ?)')
      .bind(deploymentId, id, url, launchedOn, started === null ? 'draft' : 'active'),
  ]
  if (started !== null) {
    statements.push(
      c.env.DB.prepare('INSERT INTO events (id, deployment_id, kind, occurred_at, created_at, note, actor) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), deploymentId, 'launched', started, now, '首次上线（日期精度，UTC）', c.get('actor')),
      c.env.DB.prepare('INSERT INTO lifecycle_periods (id, deployment_id, started_at) VALUES (?, ?, ?)')
        .bind(crypto.randomUUID(), deploymentId, started),
    )
  }
  await c.env.DB.batch(statements)
  return c.json({ id }, 201)
})

app.put('/api/v1/applications/:id', async c => {
  const input = updateInput.parse(await c.req.json())
  const existing = await c.env.DB.prepare('SELECT id FROM deployments WHERE application_id = ?').bind(c.req.param('id')).first<{ id: string }>()
  if (!existing) return c.json({ error: '应用不存在。' }, 404)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE deployments SET url = ?, revision = ? WHERE id = ?').bind(input.url, input.revision + 1, existing.id),
    c.env.DB.prepare('UPDATE applications SET name=?, description=?, type=?, category=?, tags=?, icon=?, color=?, size=?, favorite=? WHERE id=?')
      .bind(input.name, input.description, input.type, input.category, JSON.stringify(input.tags), input.icon, input.color, input.size, Number(input.favorite), c.req.param('id')),
  ])
  return c.json({ ok: true })
})

app.post('/api/v1/applications/:id/archive', async c => {
  const { revision } = updateInput.pick({ revision: true }).parse(await c.req.json())
  const row = await c.env.DB.prepare('SELECT id, status FROM deployments WHERE application_id=?').bind(c.req.param('id')).first<{ id: string; status: Status }>()
  if (!row) return c.json({ error: '应用不存在。' }, 404)
  if (row.status === 'active' || row.status === 'paused') return c.json({ error: '请先将应用下线，再归档。' }, 409)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE deployments SET revision=? WHERE id=?').bind(revision + 1, row.id),
    c.env.DB.prepare('UPDATE applications SET archived=1 WHERE id=?').bind(c.req.param('id')),
  ])
  return c.json({ ok: true })
})

app.get('/api/v1/deployments/:id/events', async c => {
  const result = await c.env.DB.prepare('SELECT id, kind, occurred_at AS occurredAt, note FROM events WHERE deployment_id=? ORDER BY occurred_at DESC, seq DESC')
    .bind(c.req.param('id')).all<HistoryEvent>()
  return c.json({ items: result.results })
})

app.post('/api/v1/deployments/:id/transitions', async c => {
  const input = transitionInput.parse(await c.req.json())
  const id = c.req.param('id')
  const duplicate = await c.env.DB.prepare('SELECT deployment_id FROM events WHERE id=?').bind(input.requestId).first<{ deployment_id: string }>()
  if (duplicate) return duplicate.deployment_id === id ? c.json({ ok: true }) : c.json({ error: '请求 ID 已被使用。' }, 409)
  const row = await c.env.DB.prepare('SELECT status, revision FROM deployments WHERE id=?').bind(id).first<{ status: Status; revision: number }>()
  if (!row) return c.json({ error: '部署不存在。' }, 404)
  if (row.revision !== input.revision) return c.json({ error: '数据已变更，请刷新重试。' }, 409)
  let status: Status
  try { status = nextStatus(row.status, input.action) } catch (error) {
    return c.json({ error: (error as Error).message }, 409)
  }
  const now = Date.now()
  const statements = [
    c.env.DB.prepare(`UPDATE deployments SET status=?, revision=?,
      launched_on=CASE WHEN ?='launched' THEN ? ELSE launched_on END,
      retired_at=CASE WHEN ?='retired' THEN ? ELSE retired_at END WHERE id=?`)
      .bind(status, input.revision + 1, input.action, new Date(now).toISOString().slice(0, 10), input.action, now, id),
    c.env.DB.prepare('INSERT INTO events (id, deployment_id, kind, occurred_at, created_at, note, actor) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(input.requestId, id, input.action, now, now, input.note, c.get('actor')),
  ]
  if (input.action === 'launched' || input.action === 'resumed') {
    statements.push(c.env.DB.prepare('INSERT INTO lifecycle_periods (id, deployment_id, started_at) VALUES (?, ?, ?)').bind(crypto.randomUUID(), id, now))
  }
  if (input.action === 'paused' || input.action === 'retired') {
    statements.push(c.env.DB.prepare('UPDATE lifecycle_periods SET ended_at=? WHERE deployment_id=? AND ended_at IS NULL').bind(now, id))
  }
  await c.env.DB.batch(statements)
  return c.json({ ok: true })
})

app.notFound(c => c.json({ error: '接口不存在。' }, 404))
app.onError((error, c) => {
  if (error.name === 'ZodError') return c.json({ error: '输入内容不合法，请检查名称、地址、日期和字段长度。' }, 400)
  if (error instanceof SyntaxError) return c.json({ error: 'JSON 格式不正确。' }, 400)
  if (String(error.cause ?? error).includes('revision_conflict')) return c.json({ error: '数据已被修改，请刷新后重试。' }, 409)
  const requestId = crypto.randomUUID()
  const messages: string[] = []
  let cause: unknown = error
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    messages.push(cause.message)
    cause = cause.cause
  }
  console.error('API failure', requestId, ...messages)
  if (messages.some(message => /no such (?:table|column)\b/i.test(message))) {
    return c.json({
      code: 'DB_MIGRATIONS_REQUIRED', requestId,
      error: '数据库缺少所需的表或字段。请确认 DB 绑定的是正确数据库，并将 Cloudflare 构建设置中的部署命令改为 pnpm run deploy，从最新提交重新构建部署。',
    }, 503)
  }
  return c.json({ code: 'INTERNAL_ERROR', requestId, error: `操作失败，请在 Worker 日志中查询错误编号：${requestId}` }, 500)
})

export default app
