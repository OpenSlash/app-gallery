import { useEffect, useState } from 'react'
import { ArrowTopRightIcon, Pencil1Icon, StarFilledIcon, StarIcon } from '../icons'
import { elapsedDays, statusLabels, typeLabels, type AppRecord, type EventKind, type HistoryEvent } from '../../shared/model'
import { api } from '../api'
import { AppIcon } from '../icons'
import { Dialog } from './Dialog'
import { Select } from './ui/Select'
import { ConfirmDialog } from './ui/ConfirmDialog'

const eventLabels: Record<EventKind, string> = {
  launched: '首次上线', paused: '暂停使用', resumed: '恢复使用',
  retired: '正式下线', released: '发布更新', note: '记录',
}
export function AppDetails({ app, asOf, onClose, onEdit, onUpdate, onRefresh, demo }: {
  app: AppRecord; asOf: number; onClose: () => void; onEdit: () => void
  onUpdate: (app: AppRecord) => Promise<void>; onRefresh: () => Promise<void>; demo: boolean
}) {
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<'retired' | 'archive' | null>(null)
  const [confirmError, setConfirmError] = useState('')
  useEffect(() => {
    let ignore = false
    setLoading(true)
    if (demo) { setLoading(false); return }
    api<{ items: HistoryEvent[] }>(`/deployments/${app.deploymentId}/events`)
      .then(result => { if (!ignore) setEvents(result.items) })
      .catch(error => { if (!ignore) setError(error.message) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [app.deploymentId, app.revision, demo])
  async function action(kind: EventKind) {
    setBusy(true); setError('')
    try {
      await api(`/deployments/${app.deploymentId}/transitions`, { action: kind, revision: app.revision, requestId: crypto.randomUUID(), note })
      setNote(''); await onRefresh()
    } catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function favorite() {
    setBusy(true); setError('')
    try { await onUpdate({ ...app, favorite: !app.favorite }) }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function resize(size: AppRecord['size']) {
    setBusy(true); setError('')
    try { await onUpdate({ ...app, size }) }
    catch (error) { setError((error as Error).message) } finally { setBusy(false) }
  }
  async function confirm() {
    setBusy(true); setConfirmError('')
    try {
      if (confirmation === 'archive') {
        await api(`/applications/${app.id}/archive`, { revision: app.revision })
        setConfirmation(null)
        await onRefresh(); onClose()
      } else {
        await api(`/deployments/${app.deploymentId}/transitions`, { action: 'retired', revision: app.revision, requestId: crypto.randomUUID(), note })
        setNote(''); setConfirmation(null); await onRefresh()
      }
    } catch (error) { setConfirmError((error as Error).message) } finally { setBusy(false) }
  }
  return <Dialog title="应用详情" onClose={onClose} className="details-dialog" dismissible={!busy}>
    <div className="detail-identity"><AppIcon icon={app.icon} color={app.color} iconUrl={app.iconUrl} /><div><h3>{app.name}</h3>
      <span className={`status status-${app.status}`}><i />{statusLabels[app.status]}</span><span className="detail-type">{typeLabels[app.type]} · 生产环境</span></div></div>
    <p className="detail-description">{app.description || '还没有填写应用介绍。'}</p>
    <div className="detail-actions"><a className="button primary" href={app.url} target="_blank" rel="noopener noreferrer">打开应用 <ArrowTopRightIcon /></a>
      <button className="button secondary" onClick={favorite} disabled={busy || demo}>{app.favorite ? <StarFilledIcon /> : <StarIcon />}{app.favorite ? '已收藏' : '收藏'}</button>
      <button className="button secondary" onClick={onEdit} disabled={demo || busy}><Pencil1Icon />编辑</button></div>
    <div className="detail-metrics">
      <div><span>首次上线 · UTC</span><strong>{app.launchedOn || '尚未上线'}</strong></div>
      <div><span>{app.retiredAt ? '上线至下线' : '上线至今'}</span><strong>{elapsedDays(app, asOf) === null ? '—' : `约 ${elapsedDays(app, asOf)} 天`}</strong></div>
      <div><span>累计启用 · 非监测</span><strong>约 {Math.floor(app.activeMs / 86_400_000)} 天</strong></div>
    </div>
    <div className="detail-meta"><span>访问地址</span><a href={app.url} target="_blank" rel="noopener noreferrer">{app.url}<ArrowTopRightIcon /></a></div>
    {app.tags.length > 0 && <div className="tag-list">{app.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
    <div className="detail-size"><span>卡片尺寸</span>
      <Select label="调整卡片尺寸" value={app.size} disabled={busy || demo} onValueChange={resize}
        options={[{ value: 'small', label: '小 · 1 × 1' }, { value: 'medium', label: '中 · 2 × 1' }, { value: 'large', label: '大 · 2 × 2' }]} /><span>在卡片视图中生效</span>
    </div>
    <div className="timeline-title"><h3>应用时间线</h3><span>记录每一次变化</span></div>
    {loading ? <div className="timeline-skeleton skeleton" /> : events.length ? <ol className="timeline">{events.map(event => <li key={event.id}>
      <i /><div><strong>{eventLabels[event.kind]}</strong><time>{new Date(event.occurredAt).toLocaleString('zh-CN', { timeZone: 'UTC' })} UTC</time>
        {event.note && <p>{event.note}</p>}</div></li>)}</ol> : <p className="muted">{demo ? '示例预览不会保存操作或生成真实历史。' : '还没有记录，从首次上线开始吧。'}</p>}
    {!demo && <div className="event-composer"><label>补充说明<input maxLength={1000} placeholder="版本号、更新内容，或值得记下的一件事…" value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="event-actions">
        {app.status === 'draft' && <button className="button secondary" disabled={busy} onClick={() => action('launched')}>现在上线</button>}
        {app.status === 'active' && <button className="button secondary" disabled={busy} onClick={() => action('paused')}>暂停</button>}
        {app.status === 'paused' && <button className="button secondary" disabled={busy} onClick={() => action('resumed')}>恢复使用</button>}
        {['active', 'paused'].includes(app.status) && <button className="button secondary danger" disabled={busy} onClick={() => { setConfirmError(''); setConfirmation('retired') }}>下线</button>}
        {app.status === 'active' && <button className="button secondary" disabled={busy} onClick={() => action('released')}>记录发布</button>}
        <button className="button secondary" disabled={busy || !note.trim()} onClick={() => action('note')}>添加记录</button>
        {['draft', 'retired'].includes(app.status) && <button className="button text-button danger" disabled={busy} onClick={() => { setConfirmError(''); setConfirmation('archive') }}>归档</button>}
      </div></div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {confirmation && <ConfirmDialog title={confirmation === 'retired' ? '确定将应用下线？' : '确定归档应用？'}
      description={confirmation === 'retired' ? '下线后将结束累计启用计时，且不能直接恢复。应用资料和历史记录仍会保留。' : '应用将从首页隐藏，所有历史记录仍会保留。'}
      confirmLabel={confirmation === 'retired' ? '确认下线' : '确认归档'} busy={busy} error={confirmError}
      onCancel={() => setConfirmation(null)} onConfirm={confirm} />}
  </Dialog>
}
