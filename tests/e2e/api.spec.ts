import { expect, test } from '@playwright/test'

test('D1 原子写入、版本冲突和幂等重放', async ({ request }) => {
  const headers = { Origin: 'http://127.0.0.1:4178' }
  const created = await request.post('/api/v1/applications', { headers, data: {
    name: `API test ${Date.now()}`, url: 'https://example.com', type: 'service', launchedOn: '2026-01-01',
  } })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  const list = await (await request.get('/api/v1/applications')).json()
  const app = list.items.find((item: { id: string }) => item.id === id)
  const path = `/api/v1/deployments/${app.deploymentId}/transitions`
  const requestId = crypto.randomUUID()
  const input = { action: 'paused', revision: 0, requestId, note: 'pause' }
  expect((await request.post(path, { headers, data: input })).status()).toBe(200)
  expect((await request.post(path, { headers, data: input })).status()).toBe(200)
  const stale = await request.put(`/api/v1/applications/${id}`, {
    headers, data: { ...app, name: 'should not persist', revision: 0 },
  })
  expect(stale.status()).toBe(409)
  const fresh = await (await request.get('/api/v1/applications')).json()
  const current = fresh.items.find((item: { id: string }) => item.id === id)
  expect(current.name).toBe(app.name)
  expect(current.status).toBe('paused')
  expect(current.revision).toBe(1)
  expect(current.activeMs).toBeLessThanOrEqual(app.activeMs + 10_000)
  const events = await (await request.get(`/api/v1/deployments/${app.deploymentId}/events`)).json()
  expect(events.items.filter((event: { kind: string }) => event.kind === 'paused')).toHaveLength(1)
  const results = await Promise.all([
    request.post(path, { headers, data: { action: 'resumed', revision: 1, requestId: crypto.randomUUID() } }),
    request.post(path, { headers, data: { action: 'resumed', revision: 1, requestId: crypto.randomUUID() } }),
  ])
  expect(results.map(result => result.status()).sort()).toEqual([200, 409])
  expect((await request.post(path, { headers, data: { action: 'retired', revision: 2, requestId: crypto.randomUUID() } })).status()).toBe(200)
  expect((await request.post(`/api/v1/applications/${id}/archive`, { headers, data: { revision: 3 } })).status()).toBe(200)
})

test('未来日期、危险地址、跨域写入和未知 API', async ({ request }) => {
  const headers = { Origin: 'http://127.0.0.1:4178' }
  const future = await request.post('/api/v1/applications', { headers, data: {
    name: 'future', type: 'app', url: 'https://example.com', launchedOn: '2099-01-01',
  } })
  expect(future.status()).toBe(400)
  const unsafe = await request.post('/api/v1/applications', { headers, data: {
    name: 'unsafe', type: 'app', url: 'javascript:alert(1)',
  } })
  expect(unsafe.status()).toBe(400)
  const cross = await request.post('/api/v1/applications', { headers: { Origin: 'https://evil.example.com' }, data: {} })
  expect(cross.status()).toBe(403)
  const unknown = await request.get('/api/v1/unknown')
  expect(unknown.status()).toBe(404)
  expect(unknown.headers()['content-type']).toContain('application/json')
})

test('图标地址持久化、兼容旧客户端和拒绝危险图标', async ({ request }) => {
  const headers = { Origin: 'http://127.0.0.1:4178' }
  const input = { name: `Icon API ${Date.now()}`, url: 'https://example.com', type: 'website' }
  const created = await request.post('/api/v1/applications', { headers, data: input })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  const get = async () => {
    const list = await (await request.get('/api/v1/applications')).json()
    return list.items.find((item: { id: string }) => item.id === id)
  }
  const app = await get()
  expect(app.iconUrl).toBe('')
  const uploaded = await request.post('/api/v1/icons', {
    headers: { ...headers, 'Content-Type': 'image/svg+xml' },
    data: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>',
  })
  expect(uploaded.status()).toBe(201)
  const { iconUrl } = await uploaded.json()
  expect((await request.put(`/api/v1/applications/${id}`, {
    headers, data: { ...app, iconUrl },
  })).status()).toBe(200)
  expect((await get()).iconUrl).toBe(iconUrl)
  for (const iconUrl of ['javascript:alert(1)', 'http://example.com/favicon.ico', 'https://user:pass@example.com/logo.svg']) {
    expect((await request.post('/api/v1/applications', { headers, data: { ...input, iconUrl } })).status()).toBe(400)
  }
  const withRemoteIcon = await request.post('/api/v1/applications', {
    headers, data: { ...input, iconUrl: 'https://example.com/favicon.ico' },
  })
  expect(withRemoteIcon.status()).toBe(201)
})
