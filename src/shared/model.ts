import { z } from 'zod'

export const types = ['website', 'service', 'app'] as const
export const statuses = ['draft', 'active', 'paused', 'retired'] as const
export const colors = ['forest', 'blue', 'orange', 'rose', 'slate', 'teal'] as const
export const icons = ['globe', 'code', 'database', 'image', 'cloud', 'reader', 'rocket', 'cube', 'gear', 'desktop', 'dashboard', 'lock', 'link', 'video', 'music', 'archive'] as const
export const sizes = ['small', 'medium', 'large'] as const
export const statusLabels = { draft: '未上线', active: '使用中', paused: '已暂停', retired: '已下线' }
export const typeLabels = { website: '网站', service: '基础服务', app: 'App' }

export const httpUrl = z.string().trim().max(2048).url().refine(value => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
}, '请输入不包含账号密码的 HTTP 或 HTTPS 地址')

export const appInput = z.object({
  name: z.string().trim().min(1, '请填写应用名称').max(80),
  description: z.string().trim().max(500).default(''),
  url: httpUrl,
  type: z.enum(types),
  category: z.string().trim().max(40).default(''),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  icon: z.enum(icons).default('globe'),
  color: z.enum(colors).default('forest'),
  size: z.enum(sizes).default('small'),
  favorite: z.boolean().default(false),
  launchedOn: z.iso.date().nullable().default(null),
})

export type AppInput = z.infer<typeof appInput>
export type Status = typeof statuses[number]
export type EventKind = 'launched' | 'paused' | 'resumed' | 'retired' | 'released' | 'note'
export interface AppRecord extends AppInput {
  id: string
  deploymentId: string
  status: Status
  revision: number
  createdAt: number
  retiredAt: number | null
  activeMs: number
  archived: boolean
}
export interface HistoryEvent {
  id: string
  kind: EventKind
  occurredAt: number
  note: string
}
export const transitionInput = z.object({
  revision: z.number().int().nonnegative(),
  requestId: z.uuid(),
  action: z.enum(['launched', 'paused', 'resumed', 'retired', 'released', 'note']),
  note: z.string().trim().max(1000).default(''),
})
export const updateInput = appInput.omit({ launchedOn: true }).extend({
  revision: z.number().int().nonnegative(),
})

export function nextStatus(current: Status, action: EventKind): Status {
  if (action === 'note' || action === 'released') return current
  if (current === 'draft' && action === 'launched') return 'active'
  if (current === 'active' && action === 'paused') return 'paused'
  if (current === 'paused' && action === 'resumed') return 'active'
  if ((current === 'active' || current === 'paused') && action === 'retired') return 'retired'
  throw new Error('当前状态不允许执行此操作，请刷新后重试')
}

export function utcDateStart(date: string): number {
  const parsed = z.iso.date().parse(date)
  return Date.parse(`${parsed}T00:00:00.000Z`)
}

export function elapsedDays(app: Pick<AppRecord, 'launchedOn' | 'retiredAt'>, now = Date.now()): number | null {
  if (!app.launchedOn) return null
  return Math.max(0, Math.floor(((app.retiredAt ?? now) - utcDateStart(app.launchedOn)) / 86_400_000))
}

export function matchesSearch(app: AppRecord, query: string): boolean {
  const content = [app.name, app.description, app.url, app.category, ...app.tags].join(' ').toLocaleLowerCase()
  return query.trim().toLocaleLowerCase().split(/\s+/).every(term => content.includes(term))
}
