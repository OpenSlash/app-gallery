import { expect, test } from '@playwright/test'

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

test('未配置密码时只展示配置指引，不提供公开设置入口', async ({ page }) => {
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
