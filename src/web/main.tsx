import React, { useDeferredValue, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import {
  MagnifyingGlassIcon, PlusIcon, MixerHorizontalIcon, DashboardIcon, GridIcon,
  StarIcon, StarFilledIcon, ArrowTopRightIcon, DotsHorizontalIcon, Cross2Icon,
  GlobeIcon, CubeIcon, RocketIcon,
} from './icons'
import '@fontsource-variable/geist'
import './styles.css'
import { elapsedDays, matchesSearch, statusLabels, typeLabels, type AppInput, type AppRecord } from '../shared/model'
import { api } from './api'
import { AppIcon } from './icons'
import { AppEditor } from './components/AppEditor'
import { AppDetails } from './components/AppDetails'
import { demoApps } from './demo'
import { Select } from './components/ui/Select'
import { Slider } from './components/ui/Slider'
import { Checkbox } from './components/ui/Checkbox'
import { Tooltip, TooltipProvider } from './components/ui/Tooltip'
import { AuthGate } from './components/AuthGate'
import { ApiTokens } from './components/ApiTokens'

type Preferences = { view: 'launchpad' | 'cards'; scale: number; showDays: boolean }
const defaults: Preferences = { view: 'launchpad', scale: 104, showDays: true }
function readPreferences(): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem('gallery-preferences') || '{}')
    return { view: data.view === 'cards' ? 'cards' : 'launchpad',
      scale: Number.isFinite(data.scale) ? Math.min(144, Math.max(80, data.scale)) : 104,
      showDays: typeof data.showDays === 'boolean' ? data.showDays : true }
  } catch { return defaults }
}

function App({ onLogout }: { onLogout?: () => Promise<void> }) {
  const [items, setItems] = useState<AppRecord[]>([])
  const [asOf, setAsOf] = useState(Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query)
  const [filter, setFilter] = useState('all')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('created')
  const [preferences, setPreferences] = useState(readPreferences)
  const [settings, setSettings] = useState(false)
  const [editor, setEditor] = useState<AppRecord | 'new' | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [demo, setDemo] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [tokensOpen, setTokensOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const source = demo ? demoApps() : items
  const categories = [...new Set(source.map(app => app.category).filter(Boolean))]
  const filtered = source.filter(app => matchesSearch(app, search) &&
    (filter === 'all' || (filter === 'favorites' ? app.favorite : app.type === filter)) &&
    (!category || app.category === category))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'launched' ? (b.launchedOn ?? '').localeCompare(a.launchedOn ?? '') : b.createdAt - a.createdAt)
  const detail = source.find(app => app.id === selected)
  async function refresh() {
    const result = await api<{ items: AppRecord[]; asOf: number }>('/applications')
    setItems(result.items); setAsOf(result.asOf); setError('')
  }
  useEffect(() => {
    let active = true
    api<{ items: AppRecord[]; asOf: number }>('/applications')
      .then(result => { if (active) { setItems(result.items); setAsOf(result.asOf) } })
      .catch(error => { if (active) setError(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('gallery-preferences', JSON.stringify(preferences)) } catch { /* Storage may be disabled. */ }
  }, [preferences])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchRef.current?.focus()
      }
    }
    function visible() { if (document.visibilityState === 'visible') refresh().catch(() => {}) }
    document.addEventListener('keydown', shortcut)
    document.addEventListener('visibilitychange', visible)
    const timer = window.setInterval(visible, 60_000)
    return () => { document.removeEventListener('keydown', shortcut); document.removeEventListener('visibilitychange', visible); clearInterval(timer) }
  }, [])
  function preference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences(previous => ({ ...previous, [key]: value }))
  }
  async function update(app: AppRecord) {
    await api(`/applications/${app.id}`, app, 'PUT'); await refresh()
  }
  async function save(input: AppInput) {
    if (editor && editor !== 'new') await api(`/applications/${editor.id}`, { ...input, revision: editor.revision }, 'PUT')
    else await api('/applications', input)
    setDemo(false); await refresh()
  }
  async function toggleFavorite(app: AppRecord) {
    if (demo) return
    try { await update({ ...app, favorite: !app.favorite }) } catch (error) { setError((error as Error).message) }
  }
  async function logout() {
    setLoggingOut(true)
    try { await onLogout?.() } catch (error) { setError((error as Error).message) }
    finally { setLoggingOut(false) }
  }
  return <div className="workspace">
    <header className="topbar">
      <a className="brand" href="/" aria-label="App Gallery 首页"><span className="brand-symbol"><GridIcon /></span><span>app gallery<span className="brand-dot">.</span></span></a>
      <div className="header-actions">
        <button className="button text-button" onClick={() => setTokensOpen(true)}>API Token</button>
        {onLogout && <button className="button text-button" onClick={logout} disabled={loggingOut}>{loggingOut ? '正在退出…' : '退出登录'}</button>}
      </div>
    </header>
    <main>
      <h1 className="sr-only">所有应用</h1>
      <section className="toolbar" aria-label="搜索与展示设置">
        <div className="search"><MagnifyingGlassIcon /><input ref={searchRef} aria-label="搜索应用" placeholder="搜索应用、用途或地址…" value={query} onChange={e => setQuery(e.target.value)} />
          {query ? <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><Cross2Icon /></button> : <kbd>⌘ K</kbd>}</div>
        <div className="toolbar-actions"><div className="view-toggle" aria-label="显示模式">
          <Tooltip label="启动台视图"><button aria-label="启动台视图" aria-pressed={preferences.view === 'launchpad'} onClick={() => preference('view', 'launchpad')}><GridIcon /></button></Tooltip>
          <Tooltip label="卡片视图"><button aria-label="卡片视图" aria-pressed={preferences.view === 'cards'} onClick={() => preference('view', 'cards')}><DashboardIcon /></button></Tooltip></div>
          <button className={`button customize ${settings ? 'selected' : ''}`} aria-expanded={settings} onClick={() => setSettings(!settings)}><MixerHorizontalIcon /><span>自定义</span></button>
          <button className="button primary add-button" onClick={() => setEditor('new')}><PlusIcon /><span>添加应用</span></button></div>
      </section>
      {settings && <section className="settings-panel" aria-label="自定义外观">
        <div className="scale-control"><span>图标与卡片缩放</span><span>{Math.round(preferences.scale / 104 * 100)}%</span>
          <Slider label="图标与卡片缩放" min={80} max={144} step={8} value={preferences.scale} onValueChange={value => preference('scale', value)} /></div>
        <Checkbox label="显示上线天数" checked={preferences.showDays} onCheckedChange={value => preference('showDays', value)} />
        <button className="button text-button" onClick={() => setPreferences(defaults)}>重置外观</button>
      </section>}
      <section className="collection">
        <div className="collection-nav"><div className="tabs" role="group" aria-label="应用类型">
          {[['all', '全部应用'], ['favorites', '我的收藏'], ['website', '网站'], ['service', '基础服务'], ['app', 'App']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{key === 'all' && <span>{source.length}</span>}</button>)}</div>
          <div className="select-wrap"><Select label="排序" value={sort} onValueChange={setSort} className="sort-select"
            options={[{ value: 'created', label: '最近添加' }, { value: 'name', label: '按名称排序' }, { value: 'launched', label: '最近上线' }]} /></div></div>
        {categories.length > 0 && <div className="category-bar"><button aria-pressed={!category} onClick={() => setCategory('')}>全部分类</button>{categories.map(name => <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>}
        {error && <div className="error-banner" role="alert"><div><strong>暂时无法连接应用空间</strong><p>{error}</p></div><button className="button secondary" onClick={() => refresh().catch(error => setError(error.message))}>重试</button></div>}
        {demo && <div className="demo-banner"><span>正在预览示例布局 · 这些不是你的真实应用，不会写入数据库。</span><button onClick={() => { setDemo(false); setSelected(null) }}>退出预览 <Cross2Icon /></button></div>}
        {loading ? <div className="app-grid launchpad">{Array.from({ length: 10 }, (_, i) => <div key={i} className="app-skeleton"><div className="skeleton" /><span className="skeleton" /></div>)}</div> :
          filtered.length ? <div className={`app-grid ${preferences.view}`} style={{ '--tile-size': `${preferences.scale}px` } as CSSProperties}>
            {filtered.map((app, index) => <article className={`app-tile size-${app.size}`} key={app.id} style={{ '--index': index } as CSSProperties}>
              <div className="tile-surface">
                <a className="tile-main" aria-label={`访问 ${app.name}`} href={app.url} target="_blank" rel="noopener noreferrer"><AppIcon icon={app.icon} color={app.color} iconUrl={app.iconUrl} />
                  <div className="tile-content"><h2>{app.name}</h2><p>{app.description || typeLabels[app.type]}</p>
                    <span className={`status status-${app.status}`}><i />{statusLabels[app.status]}</span></div>
                </a>
                <Tooltip label="详情与卡片尺寸"><button className="tile-more icon-button" aria-label={`${app.name} 详情与尺寸`} onClick={() => setSelected(app.id)}><DotsHorizontalIcon /></button></Tooltip>
                <div className="tile-footer"><span>{app.category || typeLabels[app.type]}</span><a href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`打开 ${app.name}`}><ArrowTopRightIcon /></a></div>
              </div>
              <div className="tile-label"><button onClick={() => setSelected(app.id)}>{app.name}</button><button className={`favorite-button ${app.favorite ? 'is-favorite' : ''}`} aria-label={`${app.favorite ? '取消收藏' : '收藏'} ${app.name}`} disabled={demo} onClick={() => toggleFavorite(app)}>{app.favorite ? <StarFilledIcon /> : <StarIcon />}</button></div>
              {preferences.showDays && <p className="tile-days">{app.launchedOn ? `${app.retiredAt ? '上线累计' : '已上线'}约 ${elapsedDays(app, asOf)} 天` : '等待第一次上线'}<span className={`mini-dot status-${app.status}`} /></p>}
            </article>)}
          </div> : !error && <div className="empty-state"><div className="empty-icons"><span><GlobeIcon /></span><span><RocketIcon /></span><span><CubeIcon /></span></div>
            <h2>{source.length ? '还没找到这个应用' : '你的应用，有了自己的位置。'}</h2>
            <p>{source.length ? '试试其他关键词，或调整分类和类型。' : '从第一个入口开始，收藏网址，记录上线的日子。'}</p>
            <div><button className="button primary" onClick={() => source.length ? (setQuery(''), setCategory(''), setFilter('all')) : setEditor('new')}>{source.length ? '清除筛选' : <><PlusIcon />添加第一个应用</>}</button>
              {!source.length && <button className="button secondary" onClick={() => setDemo(true)}>先看看示例</button>}</div></div>}
        {filtered.length > 0 && <div className="collection-bottom"><span>{filtered.length} 个应用{demo ? ' · 示例空间' : ' · 属于你的数字日常'}</span><button className="button text-button" onClick={() => setEditor('new')}><PlusIcon />再添一个入口</button></div>}
      </section>
    </main>
    <footer className="page-footer"><span>少一点寻找，多一点专注。</span><span>APP GALLERY <span className="footer-divider">/</span> YOUR PERSONAL LAUNCHPAD</span></footer>
    <nav className="dock" aria-label="收藏应用">
      <button className={`dock-home ${filter === 'all' ? 'current' : ''}`} aria-label="全部应用" onClick={() => { setFilter('all'); setCategory(''); setQuery('') }}><GridIcon /></button><span className="dock-divider" />
      {source.filter(app => app.favorite).slice(0, 7).map(app => <Tooltip key={app.id} label={app.name}><a className="dock-app" href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`打开收藏 ${app.name}`}><AppIcon icon={app.icon} color={app.color} iconUrl={app.iconUrl} /></a></Tooltip>)}
      {!source.some(app => app.favorite) && <button className="dock-placeholder" onClick={() => setFilter('favorites')}><StarIcon /><span>常用应用，放在这里</span></button>}
      <span className="dock-divider" /><Tooltip label="添加应用"><button className="dock-add" aria-label="添加应用" onClick={() => setEditor('new')}><PlusIcon /></button></Tooltip>
    </nav>
    {detail && !editor && <AppDetails key={detail.id} app={detail} asOf={asOf} demo={demo} onClose={() => setSelected(null)} onEdit={() => setEditor(detail)} onUpdate={update} onRefresh={refresh} />}
    {editor && <AppEditor value={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSave={save} />}
    {tokensOpen && <ApiTokens onClose={() => setTokensOpen(false)} />}
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><TooltipProvider delayDuration={350}>
  <AuthGate>{(session, logout) => <App onLogout={session.localDev ? undefined : logout} />}</AuthGate>
</TooltipProvider></React.StrictMode>)
