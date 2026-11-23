import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractWebsiteMetadata, parseWebsiteHtml, publicUrl, readLimited } from '../../src/worker/website-metadata'
import { maxIconBytes } from '../../src/shared/icons'

const origin = 'https://gallery.example.com'
const site = 'https://product.example.com'
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/></svg>'
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
const image = () => new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
let sqlite: DatabaseSync
let db: D1Database

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../../drizzle/0006_uploaded_icons.sql', import.meta.url), 'utf8'))
  db = {
    prepare(sql: string) {
      let args: SQLInputValue[] = []
      return {
        bind(...values: SQLInputValue[]) { args = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this },
        async run() { return sqlite.prepare(sql).run(...args) },
        async first() { return sqlite.prepare(sql).get(...args) ?? null },
      }
    },
  } as unknown as D1Database
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sqlite.close() })

function mockNetwork(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.hostname === 'cloudflare-dns.com') {
      return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] })
    }
    return handler(url, init)
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('Website metadata parsing', () => {
  it('prioritizes application identity, decodes entities and resolves icons against the first base URL', () => {
    const result = parseWebsiteHtml(`
      <!doctype html><head><!-- <title>Wrong</title> -->
      <TITLE>Sign in &amp; continue</TITLE>
      <META NAME="application-name" CONTENT="团队 &amp; 产品">
      <meta property="og:site_name" content="Other name">
      <meta name="description" content=" A &quot;private&quot; product ">
      <base href="/assets/"><base href="https://wrong.example.com/">
      <link rel="shortcut icon" href="favicon.ico" sizes="32x32">
      <link rel="icon" type="image/svg+xml" href="brand.svg?theme=a&amp;v=1">
      <script>document.title = 'Ignored'</script></head>
      <body><meta name="application-name" content="Ignored body"></body>`, `${site}/console`)
    expect(result).toEqual({
      name: '团队 & 产品', description: 'A "private" product',
      iconUrls: [`${site}/assets/brand.svg?theme=a&v=1`, `${site}/assets/favicon.ico`],
    })
  })
  it('falls back to site name, OG title, then title and enforces model lengths', () => {
    expect(parseWebsiteHtml('<meta property="og:site_name" content="Site"><title>Login</title>', site).name).toBe('Site')
    expect(parseWebsiteHtml('<meta property="og:title" content="OG"><title>Login</title>', site).name).toBe('OG')
    expect(parseWebsiteHtml('<title> A &amp; B </title>', site).name).toBe('A & B')
    expect(parseWebsiteHtml('<meta name="application-name" content="  "><title>Fallback</title>', site).name).toBe('Fallback')
    const result = parseWebsiteHtml(`<title>${'x'.repeat(200)}</title><meta name="description" content="${'y'.repeat(600)}">`, site)
    expect(result.name).toHaveLength(80)
    expect(result.description).toHaveLength(500)
  })
})

describe('Public URL boundary', () => {
  it.each([
    'file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0.0.0.0/',
    'http://10.1.1.1/', 'http://172.16.0.1/', 'http://192.168.0.1/', 'http://169.254.169.254/',
    'http://100.64.0.1/', 'http://192.0.2.1/', 'http://224.0.0.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://localhost/', 'http://localhost./', 'http://a.local/', 'http://host.internal/',
    'http://product/', `${origin}/api/v1/auth/session`,
  ])('rejects disallowed target %s', input => {
    expect(() => publicUrl(input, origin)).toThrow()
  })
  it('accepts public IP products with ports and strips fragments only', () => {
    expect(publicUrl('http://20.118.174.65:8787/console#/apps', origin).href).toBe('http://20.118.174.65:8787/console')
    expect(publicUrl(`${site}/console?view=apps#home`, origin).href).toBe(`${site}/console?view=apps`)
    expect(publicUrl('https://[2606:4700:4700::1111]/', origin).hostname).toBe('[2606:4700:4700::1111]')
  })
})

describe('Authenticated server-side metadata extraction', () => {
  it('extracts login-page metadata without forwarding credentials and persists deduplicated icon bytes', async () => {
    const network = mockNetwork(url => url.pathname === '/console'
      ? html('<title>Internal Product</title><meta name="description" content="Team workspace"><link rel="icon" href="/brand.svg">', 401)
      : url.pathname === '/brand.svg' ? image() : new Response('', { status: 404 }))
    const first = await extractWebsiteMetadata(`${site}/console`, db, origin)
    expect(first).toMatchObject({ name: 'Internal Product', description: 'Team workspace', iconUrl: expect.stringMatching(/^\/api\/v1\/icons\//) })
    expect(first.warnings.join(' ')).toContain('登录')
    const second = await extractWebsiteMetadata(`${site}/console`, db, origin)
    expect(second.iconUrl).toBe(first.iconUrl)
    const row = sqlite.prepare('SELECT data, content_type FROM uploaded_icons').get()!
    expect(new TextDecoder().decode(row.data as Uint8Array)).toBe(svg)
    expect(row.content_type).toBe('image/svg+xml')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM uploaded_icons').get()?.n).toBe(1)
    for (const [, init] of network.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.has('Cookie')).toBe(false)
      expect(headers.has('Authorization')).toBe(false)
      expect(init?.credentials).toBe('omit')
      expect(init?.redirect).toBe('manual')
    }
  })
  it('uses original-site favicon instead of adopting a separate identity provider', async () => {
    const network = mockNetwork(url => {
      if (url.pathname === '/console') return new Response(null, { status: 302, headers: { Location: 'https://login.example.com/oauth' } })
      return url.pathname === '/favicon.ico' ? image() : new Response('', { status: 404 })
    })
    const result = await extractWebsiteMetadata(`${site}/console`, db, origin)
    expect(result.name).toBe('')
    expect(result.iconUrl).toMatch(/^\/api\/v1\/icons\//)
    expect(result.warnings.join(' ')).toContain('统一登录')
    expect(network.mock.calls.some(([url]) => url.toString().includes('login.example.com'))).toBe(false)
  })
  it('follows same-host redirects and resolves relative icons from the final page path', async () => {
    const network = mockNetwork(url => {
      if (url.pathname === '/') return new Response(null, { status: 302, headers: { Location: '/console/' } })
      if (url.pathname === '/console/') return html('<title>Console</title><link rel="icon" href="assets/icon.svg">')
      return url.pathname === '/console/assets/icon.svg' ? image() : new Response('', { status: 404 })
    })
    const result = await extractWebsiteMetadata(site, db, origin)
    expect(result.name).toBe('Console')
    expect(result.iconUrl).toBeTruthy()
    expect(network.mock.calls.some(([url]) => url.toString() === `${site}/console/assets/icon.svg`)).toBe(true)
  })
  it('does not mistake an HTML SPA fallback or unsafe SVG for an icon', async () => {
    mockNetwork(url => {
      if (url.pathname === '/') return html('<title>Product</title><link rel="icon" href="/bad.svg">')
      if (url.pathname === '/bad.svg') return new Response('<svg onload="alert(1)"/>', { headers: { 'Content-Type': 'image/svg+xml' } })
      if (url.pathname === '/favicon.ico') return html('<html>SPA fallback</html>')
      return url.pathname === '/favicon.svg' ? image() : new Response('', { status: 404 })
    })
    const result = await extractWebsiteMetadata(site, db, origin)
    expect(result.iconUrl).toBeTruthy()
    expect(sqlite.prepare('SELECT byte_length AS n FROM uploaded_icons').get()?.n).toBe(new TextEncoder().encode(svg).length)
  })
  it('retains useful names when images are missing, oversized, or inaccessible', async () => {
    mockNetwork(url => url.pathname === '/'
      ? html('<title>Keep this name</title><link rel="icon" href="/huge.png">')
      : url.pathname === '/huge.png'
        ? new Response(new Uint8Array(maxIconBytes + 1), { headers: { 'Content-Type': 'image/png' } })
        : new Response('', { status: 404 }))
    expect(await extractWebsiteMetadata(site, db, origin)).toMatchObject({
      name: 'Keep this name', iconUrl: '', warnings: [expect.stringContaining('未找到可用图标')],
    })
  })
  it('rejects private DNS answers and never contacts the destination', async () => {
    const network = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 1, data: '192.168.0.1' }] }))
    vi.stubGlobal('fetch', network)
    await expect(extractWebsiteMetadata(site, db, origin)).rejects.toThrow('公网 IP')
    expect(network.mock.calls.every(call => String((call as unknown[])[0]).startsWith('https://cloudflare-dns.com/'))).toBe(true)
  })
  it('rechecks icon CDN DNS and blocks private icon URLs and private redirects', async () => {
    const network = mockNetwork(url => {
      if (url.pathname === '/') return html('<title>Safe name</title><link rel="icon" href="http://169.254.169.254/token">')
      return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } })
    })
    const result = await extractWebsiteMetadata(site, db, origin)
    expect(result.name).toBe('Safe name')
    expect(result.iconUrl).toBe('')
    expect(network.mock.calls.some(([url]) => /169\.254|127\.0/.test(url.toString()))).toBe(false)
  })
  it('rejects private CDN DNS answers even if the page itself resolves publicly', async () => {
    const network = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      if (url.hostname === 'cloudflare-dns.com') {
        const data = url.searchParams.get('name') === 'cdn.example.com' ? '10.0.0.1' : '93.184.216.34'
        return Response.json({ Status: 0, Answer: [{ type: 1, data }] })
      }
      return url.pathname === '/'
        ? html('<title>Product</title><link rel="icon" href="https://cdn.example.com/logo.svg">')
        : new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', network)
    expect(await extractWebsiteMetadata(site, db, origin)).toMatchObject({ name: 'Product', iconUrl: '' })
    expect(network.mock.calls.some(([url]) => new URL(url.toString()).hostname === 'cdn.example.com')).toBe(false)
    expect(network.mock.calls.some(([url]) => url.toString().includes('name=cdn.example.com'))).toBe(true)
  })
  it('fails closed on DNS failure and handles an unreachable site without inventing metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(extractWebsiteMetadata(site, db, origin)).rejects.toThrow('无法读取网页')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM uploaded_icons').get()?.n).toBe(0)
  })
  it('bounds redirect chains and does not follow meta refresh or execute JavaScript', async () => {
    const network = mockNetwork(url => url.pathname === '/'
      ? html('<title>Static only</title><meta http-equiv="refresh" content="0;url=http://127.0.0.1"><script>fetch("http://127.0.0.1")</script>')
      : new Response(null, { status: 302, headers: { Location: '/loop' } }))
    const result = await extractWebsiteMetadata(site, db, origin)
    expect(result.name).toBe('Static only')
    expect(result.iconUrl).toBe('')
    expect(network.mock.calls.length).toBeLessThanOrEqual(32)
    expect(network.mock.calls.filter(([url]) => !url.toString().includes('dns-query')).length).toBeLessThanOrEqual(13)
  })
  it('does not swallow D1 persistence failures as a remote favicon error', async () => {
    mockNetwork(url => url.pathname === '/' ? html('<title>Product</title>') : image())
    const broken = { prepare() { throw new Error('D1 unavailable') } } as unknown as D1Database
    await expect(extractWebsiteMetadata(site, broken, origin)).rejects.toThrow('D1 unavailable')
  })
  it('aborts an unresponsive website and returns a bounded timeout error', async () => {
    vi.useFakeTimers()
    try {
      mockNetwork((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }))
      const pending = expect(extractWebsiteMetadata('http://20.118.174.65:8787/console', db, origin)).rejects.toThrow('超时')
      await vi.advanceTimersByTimeAsync(15_100)
      await pending
    } finally { vi.useRealTimers() }
  })
})

describe('Remote response limits', () => {
  it('rejects excessive declared and streamed lengths and cancels the stream', async () => {
    await expect(readLimited(new Response('x', { headers: { 'Content-Length': '9999' } }), 100)).rejects.toThrow('过大')
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(101)) },
      cancel,
    }))
    await expect(readLimited(response, 100)).rejects.toThrow('过大')
    expect(cancel).toHaveBeenCalled()
  })
})
