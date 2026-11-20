import { useEffect, useState, type FormEvent } from 'react'
import type { ApiTokenSummary } from '../../shared/api-tokens'
import { api } from '../api'
import { Dialog } from './Dialog'
import { Select } from './ui/Select'
import { ConfirmDialog } from './ui/ConfirmDialog'

const date = (value: number) => new Date(value).toLocaleString('zh-CN')

export function ApiTokens({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ApiTokenSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [days, setDays] = useState('30')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [revoking, setRevoking] = useState<ApiTokenSummary | null>(null)
  const [revokeError, setRevokeError] = useState('')

  async function refresh() {
    const result = await api<{ items: ApiTokenSummary[] }>('/auth/tokens')
    setItems(result.items)
  }
  useEffect(() => {
    let active = true
    api<{ items: ApiTokenSummary[] }>('/auth/tokens')
      .then(result => { if (active) setItems(result.items) })
      .catch(error => { if (active) setError(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function create(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setCopyStatus('')
    try {
      const result = await api<{ token: string; item: ApiTokenSummary }>('/auth/tokens', {
        name, expiresInDays: Number(days),
      })
      setSecret(result.token)
      setItems(previous => [result.item, ...previous].slice(0, 100))
      setName('')
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  async function revoke() {
    if (!revoking) return
    setBusy(true); setRevokeError('')
    try {
      await api(`/auth/tokens/${revoking.id}/revoke`, {})
      setItems(previous => previous.map(item => item.id === revoking.id ? { ...item, revokedAt: Date.now() } : item))
      // Never keep a newly issued secret visible after its token has been revoked.
      if (secret.startsWith(revoking.prefix)) { setSecret(''); setCopyStatus('') }
      setRevoking(null)
    } catch (error) { setRevokeError((error as Error).message) }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(secret); setCopyStatus('已复制，请保存到密码管理器或脚本的环境变量中。') }
    catch { setCopyStatus('复制失败，请手动选择并复制 Token。') }
  }

  return <Dialog title="API Token" onClose={onClose} dismissible={!busy} className="tokens-dialog">
    <p className="tokens-intro">让脚本添加应用，无需使用管理员密码。Token 仅有添加权限，不能读取目录或修改已有应用。</p>
    {secret ? <section className="token-secret" aria-label="新创建的 Token">
      <strong>仅显示这一次，请立即保存</strong>
      <p>关闭此窗口后无法再次查看。不要放入网址、前端代码或公开仓库。</p>
      <label htmlFor="new-api-token" className="sr-only">新 Token</label>
      <textarea id="new-api-token" rows={3} readOnly spellCheck={false} value={secret} onFocus={event => event.target.select()} />
      <div className="token-secret-actions">
        <button className="button primary" type="button" onClick={copy}>复制 Token</button>
        <button className="button secondary" type="button" onClick={() => { setSecret(''); setCopyStatus('') }}>我已保存</button>
      </div>
      {copyStatus && <p role="status">{copyStatus}</p>}
    </section> : <form className="editor token-create" onSubmit={create}>
      <label>Token 名称<input required maxLength={80} placeholder="例如：应用录入脚本" value={name}
        onChange={event => setName(event.target.value)} disabled={busy || loading} /></label>
      <div className="form-field"><span>有效期</span><Select label="Token 有效期" value={days} onValueChange={setDays}
        options={['7', '30', '90', '365'].map(value => ({ value, label: `${value} 天` }))} /></div>
      <button className="button primary" disabled={busy || loading || !name.trim()}>{busy ? '正在创建…' : '创建 Token'}</button>
    </form>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="tokens-heading"><h3>Token 列表</h3>
      <button className="button text-button" disabled={busy} onClick={() => refresh().then(() => setError('')).catch(error => setError(error.message))}>刷新列表</button>
    </div>
    {loading ? <p role="status" className="tokens-intro">正在加载…</p> : !items.length ?
      <p className="tokens-intro">还没有 Token。创建后可以随时撤销。</p> :
      <ul className="token-list">{items.map(item => {
        const status = item.revokedAt !== null ? '已撤销' : item.invalidated ? '密码已变更，已失效' :
          item.expiresAt <= Date.now() ? '已过期' : '有效'
        return <li key={item.id}>
          <div className="token-meta"><strong>{item.name}</strong><code>{item.prefix}…</code>
            <span>{status} · 到期 {date(item.expiresAt)}</span>
            <span>{item.lastUsedAt ? `最近调用 ${date(item.lastUsedAt)}` : '尚未调用'}</span>
          </div>
          {item.revokedAt === null && <button className="button secondary" disabled={busy}
            aria-label={`撤销 ${item.name}`} onClick={() => { setRevoking(item); setRevokeError('') }}>撤销</button>}
        </li>
      })}</ul>}
    <details className="token-example"><summary>如何通过 API 添加应用</summary>
      <p>将 Token 存入环境变量 APP_GALLERY_TOKEN，再运行：</p>
      <pre><code>{`curl --fail-with-body '${window.location.origin}/api/v1/applications' \\
  -H "Authorization: Bearer $APP_GALLERY_TOKEN" \\
  -H 'Content-Type: application/json' \\
  --data '{"name":"My App","url":"https://example.com","type":"website","launchedOn":"2026-01-01"}'`}</code></pre>
      <p>成功返回 HTTP 201 和应用 id。仅支持 HTTPS（本地开发除外）；每次调用创建一条应用，不自动去重。</p>
    </details>
    {revoking && <ConfirmDialog title="撤销 API Token？" description={`撤销“${revoking.name}”后，使用它的脚本将立即失去添加权限。此操作不可恢复。`}
      confirmLabel="确认撤销" busy={busy} error={revokeError} onCancel={() => setRevoking(null)} onConfirm={revoke} />}
  </Dialog>
}
