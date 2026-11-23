import { Parser } from 'htmlparser2'
import ipaddr from 'ipaddr.js'
import { maxIconBytes, validIconContent } from '../shared/icons'
import type { WebsiteMetadata } from '../shared/website-metadata'
import { storeIcon } from './icons'

const maxHtmlBytes = 512 * 1024
const redirects = new Set([301, 302, 303, 307, 308])
const clean = (text: string, length: number) => text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length)
type FetchBudget = { remaining: number }

export class MetadataError extends Error {
  constructor(message: string, public status: 400 | 422 | 504 = 422) { super(message) }
}

export function publicUrl(input: string, ownOrigin?: string): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new MetadataError('请填写完整的 HTTP 或 HTTPS 地址。', 400) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) {
    throw new MetadataError('仅支持不含账号密码的 HTTP 或 HTTPS 地址。', 400)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (ownOrigin && host === new URL(ownOrigin).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()) {
    throw new MetadataError('不能读取入口站自身的地址。', 400)
  }
  if (ipaddr.isValid(host)) {
    if (ipaddr.parse(host).range() !== 'unicast') throw new MetadataError('仅支持公网地址，不能读取本机、内网或保留 IP。', 400)
  } else if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion|arpa)$/.test(host) ||
    /(?:^|\.)metadata\.google\.internal$/.test(host)) {
    throw new MetadataError('仅支持可公开访问的域名，内网产品请手动填写。', 400)
  }
  url.hash = ''
  return url
}

export function parseWebsiteHtml(html: string, pageUrl: string) {
  const meta = new Map<string, string>()
  const links: { href: string; score: number }[] = []
  let title = ''
  let inTitle = false
  let base = pageUrl
  let hasBase = false
  let inBody = false
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (tag === 'body') inBody = true
      if (inBody) return
      if (tag === 'title') inTitle = true
      if (tag === 'meta') {
        const key = (attrs.property || attrs.name || '').toLowerCase()
        if (attrs.content && !meta.has(key)) meta.set(key, attrs.content)
      }
      if (tag === 'base' && attrs.href && !hasBase) {
        try { base = new URL(attrs.href, pageUrl).href; hasBase = true } catch { /* Ignore malformed base URLs. */ }
      }
      if (tag === 'link' && attrs.href && links.length < 32) {
        const rel = (attrs.rel || '').toLowerCase().split(/\s+/)
        if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
          const size = Math.min(512, Number(attrs.sizes?.match(/(\d+)x\d+/)?.[1]) || 0)
          links.push({ href: attrs.href, score: size + (rel.includes('icon') ? 1000 : 500) + (attrs.type === 'image/svg+xml' ? 512 : 0) })
        }
      }
    },
    ontext(text) { if (inTitle && !inBody && title.length < 4096) title += text.slice(0, 4096 - title.length) },
    onclosetag(tag) { if (tag === 'title') inTitle = false },
  }, { decodeEntities: true })
  parser.end(html)
  const iconUrls = links.sort((a, b) => b.score - a.score).flatMap(link => {
    try { return [new URL(link.href, base).href] } catch { return [] }
  })
  return {
    name: [meta.get('application-name'), meta.get('og:site_name'), meta.get('og:title'), title]
      .map(text => clean(text || '', 80)).find(Boolean) || '',
    description: [meta.get('description'), meta.get('og:description')]
      .map(text => clean(text || '', 500)).find(Boolean) || '',
    iconUrls: [...new Set(iconUrls)],
  }
}

export async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('Content-Length')) > limit) {
    await response.body?.cancel()
    throw new MetadataError('网站返回的内容过大，请手动填写。')
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) throw new MetadataError('网站返回的内容过大，请手动填写。')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

function boundedFetch(url: string, init: RequestInit, budget: FetchBudget) {
  if (budget.remaining-- <= 0) throw new MetadataError('网站请求或跳转过多，请手动填写。')
  return fetch(url, init)
}

async function verifyPublicDns(url: URL, signal: AbortSignal, budget: FetchBudget) {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (ipaddr.isValid(host)) return
  // Recheck DNS for every target and redirect, including icon/CDN destinations.
  const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const response = await boundedFetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' }, redirect: 'manual', signal, credentials: 'omit',
    }, budget)
    if (!response.ok) { await response.body?.cancel(); throw new MetadataError('暂时无法验证网站域名，请稍后重试。') }
    const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 16_384))) as {
      Status: number; Answer?: { type: number; data: string }[]
    }
    if (body.Status !== 0) throw new MetadataError('域名解析失败，请检查地址，或手动填写。')
    return (body.Answer || []).filter(answer => [1, 28].includes(answer.type)).map(answer => answer.data)
  }))
  const addresses = answers.flat()
  if (!addresses.length || addresses.some(address => !ipaddr.isValid(address) || ipaddr.parse(address).range() !== 'unicast')) {
    throw new MetadataError('域名未解析到允许的公网 IP，内网产品请手动填写。', 400)
  }
}

async function fetchPublic(input: string, ownOrigin: string, signal: AbortSignal, budget: FetchBudget, page = false) {
  let url = publicUrl(input, ownOrigin)
  const initialHost = url.hostname.replace(/^www\./, '')
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(4500)])
  for (let hop = 0; hop <= 3; hop++) {
    await verifyPublicDns(url, requestSignal, budget)
    const response = await boundedFetch(url.href, {
      method: 'GET', redirect: 'manual', credentials: 'omit', signal: requestSignal,
      headers: { Accept: page ? 'text/html,application/xhtml+xml' : 'image/*' },
    }, budget)
    if (!redirects.has(response.status)) return { response, url }
    const location = response.headers.get('Location')
    await response.body?.cancel()
    if (!location || hop === 3) throw new MetadataError('网站跳转过多或跳转地址无效，请手动填写。')
    const next = publicUrl(new URL(location, url).href, ownOrigin)
    if (page && next.hostname.replace(/^www\./, '') !== initialHost) {
      throw new MetadataError('网站跳转到其他域名（可能是统一登录页），未采用登录平台的信息；请手动填写名称。')
    }
    if (url.protocol === 'https:' && next.protocol === 'http:') throw new MetadataError('网站尝试跳转到不安全的 HTTP 地址。')
    url = next
  }
  throw new MetadataError('无法读取网站。')
}

function decodeHtml(bytes: Uint8Array, contentType: string) {
  const preview = new TextDecoder().decode(bytes.slice(0, 4096))
  const charset = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ||
    preview.match(/<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i)?.[1] || 'utf-8'
  try { return new TextDecoder(charset).decode(bytes) } catch { return new TextDecoder().decode(bytes) }
}

export async function extractWebsiteMetadata(input: string, db: D1Database, ownOrigin: string): Promise<WebsiteMetadata> {
  const initial = publicUrl(input, ownOrigin)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const budget: FetchBudget = { remaining: 32 }
  const result: WebsiteMetadata = { name: '', description: '', iconUrl: '', warnings: [] }
  let pageUrl = initial.href
  let candidates: string[] = []
  try {
    try {
      const page = await fetchPublic(initial.href, ownOrigin, controller.signal, budget, true)
      pageUrl = page.url.href
      const type = page.response.headers.get('Content-Type') || ''
      if ([401, 403].includes(page.response.status)) result.warnings.push('网站要求登录，识别结果可能来自登录页，请确认名称。')
      if (!page.response.ok && ![401, 403].includes(page.response.status)) {
        await page.response.body?.cancel()
        throw new MetadataError(`网站返回 HTTP ${page.response.status}，可手动填写名称。`)
      }
      if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type)) {
        await page.response.body?.cancel()
        throw new MetadataError('网站未返回 HTML 页面，无法提取名称。')
      }
      const parsed = parseWebsiteHtml(decodeHtml(await readLimited(page.response, maxHtmlBytes), type), pageUrl)
      result.name = parsed.name
      result.description = parsed.description
      candidates = parsed.iconUrls
    } catch (error) {
      result.warnings.push(error instanceof MetadataError ? error.message : '无法读取网页（可能超时、网络受限或需要登录），可手动填写名称。')
    }
    candidates = [...new Set([...candidates.slice(0, 3), ...['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png'].map(path => new URL(path, pageUrl).href)])].slice(0, 5)
    let found: { bytes: Uint8Array; type: string } | undefined
    for (const candidate of candidates) {
      if (controller.signal.aborted) break
      try {
        const { response } = await fetchPublic(candidate, ownOrigin, controller.signal, budget)
        if (!response.ok) { await response.body?.cancel(); continue }
        const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() || ''
        const bytes = await readLimited(response, maxIconBytes)
        if (validIconContent(bytes, type)) { found = { bytes, type }; break }
      } catch { /* A missing or unsafe favicon must not discard usable page metadata. */ }
    }
    // Database errors are not swallowed as ordinary remote-site failures.
    if (found) result.iconUrl = (await storeIcon(db, found.bytes, found.type)).iconUrl
    if (!result.name && !result.iconUrl) {
      throw new MetadataError(controller.signal.aborted
        ? '获取超时，请稍后重试，或手动填写名称并上传图标。'
        : result.warnings[0] || '未找到网站名称和有效图标，请手动填写。', controller.signal.aborted ? 504 : 422)
    }
    if (!result.name) result.warnings.push('未找到应用名称，请手动填写。')
    if (!result.iconUrl) result.warnings.push('未找到可用图标，已保留原图标，可手动上传。')
    return result
  } finally { clearTimeout(timer) }
}
