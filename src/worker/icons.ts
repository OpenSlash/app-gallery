import { Hono } from 'hono'
import type { Env } from './auth'
import { validIconContent } from '../shared/icons'

export const iconRoutes = new Hono<{ Bindings: Env }>()

export async function storeIcon(db: D1Database, data: Uint8Array, contentType: string) {
  if (!validIconContent(data, contentType)) throw new Error('Invalid icon content')
  const bytes = new Uint8Array(data)
  const hashBytes = await crypto.subtle.digest('SHA-256', bytes)
  const hash = [...new Uint8Array(hashBytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const id = crypto.randomUUID()
  await db.prepare(`
    INSERT INTO uploaded_icons (id, content_hash, content_type, data, byte_length, created_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(content_hash) DO NOTHING
  `).bind(id, hash, contentType, bytes.buffer, bytes.length, Date.now()).run()
  const stored = await db.prepare('SELECT id FROM uploaded_icons WHERE content_hash=?')
    .bind(hash).first<{ id: string }>()
  if (!stored) throw new Error('Uploaded icon was not persisted')
  return { id: stored.id, iconUrl: `/api/v1/icons/${stored.id}` }
}

iconRoutes.post('/', async c => {
  const data = new Uint8Array(await c.req.arrayBuffer())
  const contentType = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (!validIconContent(data, contentType)) return c.json({ error: '图标内容或格式无效，请使用 PNG、JPEG、WebP、ICO 或不含脚本及外部资源的 SVG。' }, 400)
  return c.json(await storeIcon(c.env.DB, data, contentType), 201)
})

iconRoutes.get('/:id', async c => {
  const stored = await c.env.DB.prepare('SELECT content_type, data FROM uploaded_icons WHERE id=?')
    .bind(c.req.param('id')).first<{ content_type: string; data: number[] | ArrayBuffer | Uint8Array }>()
  if (!stored) return c.json({ error: '图标不存在。' }, 404)
  c.header('Content-Type', stored.content_type)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
  c.header('Cross-Origin-Resource-Policy', 'same-origin')
  c.header('Content-Disposition', 'inline')
  const bytes = stored.data instanceof ArrayBuffer ? new Uint8Array(stored.data) : new Uint8Array(stored.data)
  return c.body(bytes)
})
