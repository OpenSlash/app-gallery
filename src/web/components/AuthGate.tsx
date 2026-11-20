import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import { GridIcon } from '../icons'
import type { PasswordConfigurationIssue } from '../../shared/auth'

type Session = { configured: boolean; authenticated: boolean; localDev: boolean; configurationIssue?: PasswordConfigurationIssue; setupRequired?: boolean }

export function AuthGate({ children }: {
  children: (session: Session, logout: () => Promise<void>) => ReactNode
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const issue = session?.configurationIssue

  async function check() {
    const result = await api<Session>('/auth/session')
    setSession(result)
    setError('')
  }
  useEffect(() => {
    let active = true
    api<Session>('/auth/session').then(result => { if (active) setSession(result) })
      .catch(error => { if (active) setError(error.message) })
    const expired = () => {
      setSession(previous => previous ? { ...previous, authenticated: false } : null)
      setError('会话已过期，请重新登录。')
    }
    window.addEventListener('gallery-session-expired', expired)
    return () => { active = false; window.removeEventListener('gallery-session-expired', expired) }
  }, [])
  useEffect(() => {
    if (!session || session.configured) return
    let active = true
    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      api<Session>('/auth/session').then(result => { if (active) setSession(result) }).catch(() => {})
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    const timer = window.setInterval(recheck, 15_000)
    return () => {
      active = false
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
      window.clearInterval(timer)
    }
  }, [session?.configured])

  async function login(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await api('/auth/login', { password })
      setPassword('')
      await check()
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  async function setup(event: FormEvent) {
    event.preventDefault()
    setError(''); setNotice('')
    if (password.trim().length < 16 || password.length > 256) {
      setError('请使用 16 至 256 位的密码，去除首尾空白后至少 16 位。')
      return
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致。')
      return
    }
    setBusy(true)
    try {
      await api('/auth/setup', { password, confirmPassword })
      setPassword(''); setConfirmPassword('')
      await check()
      setNotice('密码已设置，请登录。')
    } catch (error) {
      const message = (error as Error).message
      // Another browser may have completed initialization while this form was open.
      await check().catch(() => {})
      setError(message)
    } finally { setBusy(false) }
  }
  async function logout() {
    await api('/auth/logout', {})
    setSession(previous => previous ? { ...previous, authenticated: false } : null)
    setPassword(''); setConfirmPassword(''); setError(''); setNotice('')
  }

  if (session?.authenticated) return children(session, logout)
  return <div className="workspace auth-workspace">
    <header className="topbar">
      <a className="brand" href="/" aria-label="App Gallery 首页"><span className="brand-symbol"><GridIcon /></span><span>app gallery<span className="brand-dot">.</span></span></a>
    </header>
    <main className="auth-main">
      <section className="auth-panel" aria-labelledby="auth-title" aria-busy={busy}>
        <span className="auth-eyebrow">APP GALLERY / PRIVATE</span>
        <h1 id="auth-title">{!session ? '正在连接应用空间' : session.configured ? '登录你的应用空间' : '设置管理员密码'}</h1>
        {!session ? <>
          {error ? <p className="auth-error" role="alert">{error}</p> : <div className="auth-skeleton skeleton" />}
          {error && <button className="button secondary" onClick={() => check().catch(error => setError(error.message))}>重新连接</button>}
        </> : session.configured ? <form onSubmit={login}>
          {notice && <p role="status">{notice}</p>}
          <label htmlFor="admin-password">管理员密码</label>
          <input id="admin-password" name="password" type="password" autoComplete="current-password" required
            maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button primary" type="submit" disabled={busy || !password}>{busy ? '正在登录…' : '进入应用空间'}</button>
        </form> : session.setupRequired ? <form onSubmit={setup}>
          <p>首次使用，请创建管理员密码。密码加盐哈希后保存在 D1，无需配置 Cloudflare Secret。</p>
          <p>初始化完成前，任何能访问本站的人都可设置密码，请立即完成。</p>
          <label htmlFor="setup-password">管理员密码</label>
          <input id="setup-password" name="password" type="password" autoComplete="new-password" required
            minLength={16} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          <label htmlFor="confirm-password">确认密码</label>
          <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required
            minLength={16} maxLength={256} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={busy} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button primary" type="submit" disabled={busy || !password || !confirmPassword}>
            {busy ? '正在保存…' : '设置密码'}
          </button>
        </form> : <>
          <p role="status">{issue === 'too_short' ? 'Worker 已读取到密码，但去除首尾空白后不足 16 位。' :
            issue === 'too_long' ? 'Worker 已读取到密码，但长度超过 256 位。' :
              issue === 'missing' ? '当前运行的 Worker 未读取到 ADMIN_PASSWORD，并非密码输入错误。' :
                '当前 API 未提供具体配置原因，请确认前端和 Worker 均已更新到最新版本。'}</p>
          <p>在 Cloudflare 的 Workers 与 Pages 中打开本站 Worker，进入设置中的变量和机密，添加类型为 Secret 的 <code>ADMIN_PASSWORD</code>。</p>
          <p>确认是当前网址对应的 Worker 和生产环境，不是构建设置中的变量。使用 16 至 256 位的独立长密码，点击部署后重新检查。配置完成前，数据接口保持锁定。</p>
          <button className="button secondary" onClick={() => check().catch(error => setError(error.message))}>我已设置，重新检查</button>
          {error && <p className="auth-error" role="alert">{error}</p>}
        </>}
      </section>
    </main>
  </div>
}
