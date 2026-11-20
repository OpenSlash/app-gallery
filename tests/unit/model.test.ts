import { describe, expect, it } from 'vitest'
import { appInput, elapsedDays, matchesSearch, nextStatus, utcDateStart, type AppRecord } from '../../src/shared/model'

describe('生命周期', () => {
  it('首次上线、暂停、恢复、下线', () => {
    expect(nextStatus('draft', 'launched')).toBe('active')
    expect(nextStatus('active', 'paused')).toBe('paused')
    expect(nextStatus('paused', 'resumed')).toBe('active')
    expect(nextStatus('paused', 'retired')).toBe('retired')
  })
  it('下线不可恢复，非法状态变更被拒绝', () => {
    expect(() => nextStatus('retired', 'resumed')).toThrow()
    expect(() => nextStatus('draft', 'paused')).toThrow()
    expect(() => nextStatus('active', 'launched')).toThrow()
  })
  it('记录和发布不重置状态', () => {
    expect(nextStatus('active', 'released')).toBe('active')
    expect(nextStatus('retired', 'note')).toBe('retired')
  })
})

describe('时间口径', () => {
  it('从 UTC 日期计算，不受浏览器时区影响', () => {
    expect(utcDateStart('2026-11-01')).toBe(Date.UTC(2026, 10, 1))
    expect(elapsedDays({ launchedOn: '2026-11-01', retiredAt: null }, Date.UTC(2026, 10, 18))).toBe(17)
  })
  it('下线后停止计算，未上线为空', () => {
    expect(elapsedDays({ launchedOn: '2026-11-01', retiredAt: Date.UTC(2026, 10, 5) }, Date.UTC(2026, 10, 18))).toBe(4)
    expect(elapsedDays({ launchedOn: null, retiredAt: null })).toBeNull()
  })
  it('拒绝不存在的日期', () => {
    expect(() => utcDateStart('2026-02-30')).toThrow()
  })
})

describe('输入与搜索', () => {
  it('只允许不带凭据的 HTTP 地址', () => {
    const data = { name: '工具', type: 'website' }
    expect(appInput.safeParse({ ...data, url: 'https://example.com' }).success).toBe(true)
    for (const url of ['javascript:alert(1)', 'ftp://example.com', 'https://user:password@example.com']) {
      expect(appInput.safeParse({ ...data, url }).success).toBe(false)
    }
  })
  it('搜索用途、标签、域名，支持多个关键词', () => {
    const app = { name: 'Paper', description: '记录想法', category: '效率', tags: ['文档'], url: 'https://notes.example.com' } as AppRecord
    expect(matchesSearch(app, 'PAPER 文档')).toBe(true)
    expect(matchesSearch(app, 'notes')).toBe(true)
    expect(matchesSearch(app, '不存在')).toBe(false)
  })
})
