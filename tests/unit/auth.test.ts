import { describe, expect, it } from 'vitest'
import worker from '../../src/worker/index'

describe('私有 API', () => {
  it('缺少 Access 配置时安全锁定', async () => {
    const response = await worker.request('https://gallery.example.com/api/v1/applications', {}, {})
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
  it('配置后，缺少 JWT 不允许访问', async () => {
    const response = await worker.request('https://gallery.example.com/api/v1/applications', {}, {
      ACCESS_TEAM_DOMAIN: 'demo.cloudflareaccess.com', ACCESS_AUD: 'demo',
    })
    expect(response.status).toBe(401)
  })
  it('生产域名不能使用本地开发开关绕过认证', async () => {
    const response = await worker.request('https://gallery.example.com/api/v1/applications', {}, { LOCAL_DEV: 'true' })
    expect(response.status).toBe(503)
  })
  it('本地写操作拒绝跨域请求', async () => {
    const response = await worker.request('http://127.0.0.1/api/v1/applications', {
      method: 'POST', headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' }, body: '{}',
    }, { LOCAL_DEV: 'true' })
    expect(response.status).toBe(403)
  })
  it('本地 API 未知路由返回 JSON 404', async () => {
    const response = await worker.request('http://localhost/api/v1/missing', {}, { LOCAL_DEV: 'true' })
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
  })
})
