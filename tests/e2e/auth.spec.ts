import { expect, test } from '@playwright/test'

test.beforeAll(async ({ request }) => {
  const status = await (await request.get('/api/v1/auth/session')).json()
  if (status.setupRequired) {
    const response = await request.post('/api/v1/auth/setup', {
      headers: { Origin: 'http://127.0.0.1:4179' },
      data: { password: 'test-only-password-for-browser', confirmPassword: 'test-only-password-for-browser' },
    })
    expect(response.status()).toBe(201)
  }
})

test('密码登录、刷新保持会话、退出撤销和过期回到登录页', async ({ page, request }) => {
  expect((await request.get('/api/v1/applications')).status()).toBe(401)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '登录你的应用空间' })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加应用', exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/auth-desktop.png' })
  await page.getByLabel('管理员密码').fill('incorrect')
  await page.getByRole('button', { name: '进入应用空间' }).click()
  await expect(page.getByRole('alert')).toHaveText('密码不正确。')
  await page.getByLabel('管理员密码').fill('test-only-password-for-browser')
  await page.getByRole('button', { name: '进入应用空间' }).click()
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()
  await expect(page.getByRole('region', { name: '搜索与展示设置' }).getByRole('button', { name: '添加应用', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()
  const cookies = await page.context().cookies()
  const session = cookies.find(cookie => cookie.name === 'gallery-session')!
  expect(session.httpOnly).toBe(true)
  expect(session.sameSite).toBe('Strict')
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '登录你的应用空间' })).toBeVisible()
  const replay = await request.get('/api/v1/applications', { headers: { Cookie: `${session.name}=${session.value}` } })
  expect(replay.status()).toBe(401)
  await page.getByLabel('管理员密码').fill('test-only-password-for-browser')
  await page.getByRole('button', { name: '进入应用空间' }).click()
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()
  await page.context().clearCookies()
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('heading', { name: '登录你的应用空间' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('会话已过期，请重新登录。')
  await expect(page.getByRole('button', { name: '添加应用', exact: true })).toHaveCount(0)
})

test('移动端登录布局和密码字段', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '登录你的应用空间' })).toBeVisible()
  await expect(page.getByLabel('管理员密码')).toHaveAttribute('type', 'password')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/auth-mobile.png' })
})

test('旧版 API 未声明初始化能力时仍展示配置指引', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => route.fulfill({
    json: { configured: false, authenticated: false, localDev: false },
  }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '设置管理员密码' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('当前 API 未提供具体配置原因')
  await expect(page.getByText('ADMIN_PASSWORD', { exact: true })).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '添加应用', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '我已设置，重新检查' }).click()
  await expect(page.getByRole('heading', { name: '设置管理员密码' })).toBeVisible()
})

test('区分密码缺失和长度错误，回到页面时自动重新检测', async ({ page }) => {
  let issue: 'missing' | 'too_short' | 'too_long' | null = 'missing'
  await page.route('**/api/v1/auth/session', route => route.fulfill({
    json: { configured: issue === null, authenticated: false, localDev: false, configurationIssue: issue },
  }))
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('未读取到 ADMIN_PASSWORD')
  issue = 'too_short'
  await page.getByRole('button', { name: '我已设置，重新检查' }).click()
  await expect(page.getByRole('status')).toContainText('不足 16 位')
  issue = 'too_long'
  await page.getByRole('button', { name: '我已设置，重新检查' }).click()
  await expect(page.getByRole('status')).toContainText('超过 256 位')
  issue = null
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '登录你的应用空间' })).toBeVisible()
})

test('首次设置密码表单校验、保存并进入登录页面', async ({ page }) => {
  let configured = false
  let submitted = 0
  await page.route('**/api/v1/auth/session', route => route.fulfill({
    json: { configured, authenticated: false, localDev: false, setupRequired: !configured },
  }))
  await page.route('**/api/v1/auth/setup', route => {
    const body = route.request().postDataJSON()
    expect(body).toEqual({ password: 'new-test-password-for-browser', confirmPassword: 'new-test-password-for-browser' })
    submitted++
    configured = true
    return route.fulfill({ status: 201, json: { ok: true } })
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '设置管理员密码' })).toBeVisible()
  await expect(page.getByLabel('管理员密码', { exact: true })).toHaveAttribute('autocomplete', 'new-password')
  await page.getByLabel('管理员密码', { exact: true }).fill('new-test-password-for-browser')
  await page.getByLabel('确认密码').fill('another-test-password-for-browser')
  await page.getByRole('button', { name: '设置密码', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('两次输入的密码不一致。')
  expect(submitted).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel('确认密码').fill('new-test-password-for-browser')
  await page.screenshot({ path: 'test-results/setup-mobile.png' })
  await page.getByRole('button', { name: '设置密码', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录你的应用空间' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('密码已设置，请登录。')
  await expect(page.getByLabel('管理员密码', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('确认密码')).toHaveCount(0)
})

test('其他浏览器完成初始化时不能覆盖密码', async ({ page }) => {
  let configured = false
  await page.route('**/api/v1/auth/session', route => route.fulfill({
    json: { configured, authenticated: false, localDev: false, setupRequired: !configured },
  }))
  await page.route('**/api/v1/auth/setup', route => {
    configured = true
    return route.fulfill({ status: 409, json: { error: '管理员密码已设置，请直接登录。' } })
  })
  await page.goto('/')
  await page.getByLabel('管理员密码', { exact: true }).fill('new-test-password-for-browser')
  await page.getByLabel('确认密码').fill('new-test-password-for-browser')
  await page.getByRole('button', { name: '设置密码', exact: true }).click()
  await expect(page.getByRole('heading', { name: '登录你的应用空间' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('管理员密码已设置，请直接登录。')
})

test('创建 Token、上传图标和编辑应用、隐藏明文并撤销', async ({ page, request }) => {
  const name = `browser integration ${Date.now()}`
  await page.goto('/')
  await page.getByLabel('管理员密码').fill('test-only-password-for-browser')
  await page.getByRole('button', { name: '进入应用空间' }).click()
  await page.getByRole('button', { name: 'API Token', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('API Token')
  await page.getByLabel('Token 名称', { exact: true }).fill(name)
  await page.getByRole('combobox', { name: 'Token 有效期' }).click()
  await page.getByRole('option', { name: '7 天', exact: true }).click()
  await page.getByRole('button', { name: '创建 Token', exact: true }).click()
  const token = await page.getByLabel('新 Token', { exact: true }).inputValue()
  expect(token).toMatch(/^ag_[a-f0-9]{64}$/)
  expect((await request.get('/api/v1/applications')).status()).toBe(401)
  const headers = { Authorization: `Bearer ${token}` }
  const created = await request.post('/api/v1/applications', { headers, data: {
    name, type: 'service', url: 'https://example.com', tags: ['preserve'], icon: 'cloud', color: 'blue', size: 'large', favorite: true,
  } })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  const read = await request.get(`/api/v1/applications/${id}`, { headers })
  expect(read.status()).toBe(200)
  const { item } = await read.json()
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="#22c55e"/></svg>'
  const upload = await request.post('/api/v1/icons', {
    headers: { ...headers, 'Content-Type': 'image/svg+xml' }, data: svg,
  })
  expect(upload.status()).toBe(201)
  const { iconUrl } = await upload.json()
  const image = await request.get(iconUrl, { headers })
  expect(image.status()).toBe(200)
  expect(await image.text()).toBe(svg)
  expect(image.headers()['content-security-policy']).toContain('sandbox')
  const updated = await request.patch(`/api/v1/applications/${id}`, {
    headers, data: { revision: item.revision, url: 'http://example.com/console', iconUrl },
  })
  expect(updated.status()).toBe(200)
  const { item: current } = await (await request.get(`/api/v1/applications/${id}`, { headers })).json()
  expect(current).toMatchObject({
    url: 'http://example.com/console', iconUrl, name, revision: 1,
    tags: ['preserve'], icon: 'cloud', color: 'blue', size: 'large', favorite: true,
  })
  expect((await request.patch(`/api/v1/applications/${id}`, {
    headers, data: { revision: 0, name: 'stale' },
  })).status()).toBe(409)
  const writes = await Promise.all(['A', 'B'].map(description => request.patch(`/api/v1/applications/${id}`, {
    headers, data: { revision: 1, description },
  })))
  expect(writes.map(response => response.status()).sort()).toEqual([200, 409])
  expect((await request.post(`/api/v1/applications/${id}/archive`, { headers, data: { revision: 2 } })).status()).toBe(403)
  const adminList = await (await page.request.get('/api/v1/applications')).json()
  expect(adminList.items.some((item: { id: string }) => item.id === id)).toBe(true)
  expect((await request.get('/api/v1/applications', { headers })).status()).toBe(403)
  await page.getByRole('button', { name: '我已保存', exact: true }).click()
  await expect(page.getByLabel('新 Token', { exact: true })).toHaveCount(0)
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(stored).not.toContain(token)
  await page.screenshot({ path: 'test-results/api-tokens-desktop.png', animations: 'disabled' })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: 'API Token', exact: true }).click()
  await expect(page.getByLabel('新 Token', { exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByText('如何通过 API 添加应用', { exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/api-tokens-mobile.png', animations: 'disabled' })
  await page.getByRole('button', { name: `撤销 ${name}`, exact: true }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: '确认撤销', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.locator('.token-list li').filter({ hasText: name })).toContainText('已撤销')
  expect((await request.post('/api/v1/applications', { headers, data: {
    name: 'must not persist', type: 'service', url: 'https://example.com',
  } })).status()).toBe(401)
  expect((await request.patch(`/api/v1/applications/${id}`, { headers, data: { revision: 2, name: 'revoked' } })).status()).toBe(401)
  expect((await request.post('/api/v1/icons', {
    headers: { ...headers, 'Content-Type': 'image/svg+xml' }, data: svg,
  })).status()).toBe(401)
  expect((await request.get(iconUrl)).status()).toBe(401)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  expect((await page.request.post(`/api/v1/applications/${id}/archive`, {
    headers: { Origin: 'http://127.0.0.1:4179' }, data: { revision: 2 },
  })).status()).toBe(200)
})
