import type { AppRecord } from '../shared/model'

const entries = [
  ['Paper', '给想法一个安静的地方', 'reader', 'forest', 'website', '工作效率', 'small'],
  ['Cloudflare', '我的边缘网络与基础设施', 'cloud', 'orange', 'service', '基础设施', 'medium'],
  ['Code Studio', '从一个想法到下一次发布', 'code', 'slate', 'app', '开发工具', 'small'],
  ['Photo Library', '收集日常里的微小瞬间', 'image', 'rose', 'website', '生活与创作', 'large'],
  ['Supabase', '项目背后的数据空间', 'database', 'teal', 'service', '基础设施', 'small'],
  ['Read Later', '留给周末的好文章', 'reader', 'blue', 'app', '工作效率', 'small'],
  ['Portfolio', '设计、代码和一些小作品', 'globe', 'forest', 'website', '生活与创作', 'medium'],
  ['Launch Log', '记录每一个上线的日子', 'rocket', 'orange', 'app', '开发工具', 'small'],
  ['API Console', '服务接口的统一工作台', 'cube', 'blue', 'service', '开发工具', 'small'],
] as const

export function demoApps(): AppRecord[] {
  return entries.map(([name, description, icon, color, type, category, size], index) => ({
    id: `demo-${index}`, deploymentId: `demo-${index}`, name, description, icon, color, type, category, size,
    tags: ['示例'], url: 'https://example.com', launchedOn: `2026-0${(index % 8) + 1}-01`,
    favorite: index < 5, status: index === 5 ? 'paused' : 'active',
    revision: 0, createdAt: 0, retiredAt: null, activeMs: (index + 20) * 86_400_000, archived: false,
  }))
}
