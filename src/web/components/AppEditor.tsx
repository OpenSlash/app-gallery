import { useState, type ChangeEvent, type FormEvent } from 'react'
import { CheckIcon } from '../icons'
import { colors, icons, sizes, types, typeLabels, appInput, type AppInput, type AppRecord } from '../../shared/model'
import { AppIcon, iconLabels } from '../icons'
import { Dialog } from './Dialog'
import { Select } from './ui/Select'
import { Checkbox } from './ui/Checkbox'
import { Tooltip } from './ui/Tooltip'
import { maxIconBytes } from '../../shared/icons'
import { uploadIcon } from '../api'

const empty: AppInput = {
  name: '', description: '', url: '', type: 'website', category: '', tags: [],
  icon: 'globe', iconUrl: '', color: 'forest', size: 'small', favorite: false, launchedOn: null,
}
export function AppEditor({ value, onClose, onSave }: {
  value?: AppRecord; onClose: () => void; onSave: (data: AppInput) => Promise<void>
}) {
  const [data, setData] = useState<AppInput>(value ? { ...value, iconUrl: value.iconUrl ?? '' } : empty)
  const [tagText, setTagText] = useState(value?.tags.join(', ') ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  function field<K extends keyof AppInput>(key: K, value: AppInput[K]) {
    setData(previous => ({ ...previous, [key]: value }))
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (uploading) return
    const input = { ...data, tags: [...new Set(tagText.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] }
    const parsed = appInput.safeParse(input)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查输入'); return }
    setSaving(true); setError('')
    try { await onSave(parsed.data); onClose() } catch (error) {
      setError((error as Error).message)
    } finally { setSaving(false) }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > maxIconBytes) { setError('图标不能超过 256 KB。'); return }
    setUploading(true); setError('')
    try {
      const result = await uploadIcon(file)
      field('iconUrl', result.iconUrl)
    } catch (error) { setError((error as Error).message) }
    finally { setUploading(false) }
  }
  return <Dialog title={value ? '编辑应用' : '添加到我的空间'} onClose={onClose} dismissible={!saving && !uploading}>
    <form onSubmit={submit} className="editor">
      <div className="icon-picker"><AppIcon icon={data.icon} color={data.color} iconUrl={data.iconUrl} />
        <div><span className="field-caption">给应用一个熟悉的样子</span>
          <div className="icon-options">{icons.map(icon => <Tooltip label={iconLabels[icon]} key={icon}><button type="button" aria-label={`图标：${iconLabels[icon]}`}
            disabled={uploading} aria-pressed={!data.iconUrl && data.icon === icon} onClick={() => setData(previous => ({ ...previous, icon, iconUrl: '' }))}><AppIcon icon={icon} color={data.color} /></button></Tooltip>)}</div>
          <div className="color-options">{colors.map((color, index) => <Tooltip key={color} label={['森林', '雾蓝', '暖橙', '玫瑰', '岩灰', '青绿'][index]}><button type="button" className={`color-${color}`}
            aria-label={`颜色：${['森林', '雾蓝', '暖橙', '玫瑰', '岩灰', '青绿'][index]}`} aria-pressed={data.color === color} onClick={() => field('color', color)}>{data.color === color && <CheckIcon />}</button></Tooltip>)}</div>
        </div>
      </div>
      <div className="form-grid">
        <label>应用名称<input autoFocus required maxLength={80} placeholder="例如：我的博客" value={data.name} onChange={e => field('name', e.target.value)} /></label>
        <div className="form-field"><span>应用类型</span><Select label="应用类型" value={data.type} onValueChange={value => field('type', value)} options={types.map(type => ({ value: type, label: typeLabels[type] }))} /></div>
        <label className="full">访问地址<input type="url" required maxLength={2048} placeholder="https://example.com" value={data.url} onChange={e => field('url', e.target.value)} /></label>
        <div className="form-field full website-icon-field">
          <label>上传应用图标<input type="file" accept=".png,.jpg,.jpeg,.webp,.ico,.svg" disabled={saving || uploading} onChange={upload} /></label>
          {uploading && <span role="status">正在上传图标…</span>}
          <small>PNG、JPEG、WebP、ICO 或 SVG，最大 256 KB。图标保存到 D1，保存应用后生效，不写入代码仓库。</small>
          <label>网站图标地址<input maxLength={2048} placeholder="上传后自动填写，也可填写 HTTPS 图片地址" value={data.iconUrl} disabled={uploading} onChange={e => field('iconUrl', e.target.value)} /></label>
          <div className="website-icon-actions">
            <button type="button" className="button text-button" disabled={!data.iconUrl || uploading} onClick={() => field('iconUrl', '')}>恢复内置图标</button>
          </div>
          <small>加载失败时显示内置图标；HTTP 站点的图标请下载后上传，避免混合内容。</small>
        </div>
        <label className="full">一句话介绍<textarea rows={2} maxLength={500} placeholder="它是做什么的？未来的自己会感谢这句话。" value={data.description} onChange={e => field('description', e.target.value)} /></label>
        <label>分类<input maxLength={40} placeholder="例如：工作效率" value={data.category} onChange={e => field('category', e.target.value)} /></label>
        <label>标签<input placeholder="用逗号分隔" value={tagText} onChange={e => setTagText(e.target.value)} /></label>
        <label>首次上线日期 · UTC<input type="date" disabled={Boolean(value)} max={new Date().toISOString().slice(0, 10)} value={data.launchedOn ?? ''} onChange={e => field('launchedOn', e.target.value || null)} />
          <small>{value ? '历史日期不在此处修改，避免影响启用记录。' : '可补录；留空则标记为未上线。'}</small></label>
        <div className="form-field"><span>卡片尺寸</span><Select label="卡片尺寸" value={data.size} onValueChange={value => field('size', value)} options={sizes.map((size, i) => ({ value: size, label: ['小 · 1 × 1', '中 · 2 × 1', '大 · 2 × 2'][i] }))} /></div>
      </div>
      <Checkbox label="收藏到 Dock" checked={data.favorite} onCheckedChange={value => field('favorite', value)} />
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose} disabled={saving || uploading}>取消</button>
        <button className="button primary" disabled={saving || uploading}>{saving ? '正在保存…' : value ? '保存更改' : '添加应用'}</button></div>
    </form>
  </Dialog>
}
