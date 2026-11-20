import { useState, type FormEvent } from 'react'
import { CheckIcon } from '../icons'
import { colors, icons, sizes, types, typeLabels, appInput, type AppInput, type AppRecord } from '../../shared/model'
import { AppIcon, iconLabels } from '../icons'
import { Dialog } from './Dialog'
import { Select } from './ui/Select'
import { Checkbox } from './ui/Checkbox'
import { Tooltip } from './ui/Tooltip'

const empty: AppInput = {
  name: '', description: '', url: '', type: 'website', category: '', tags: [],
  icon: 'globe', color: 'forest', size: 'small', favorite: false, launchedOn: null,
}
export function AppEditor({ value, onClose, onSave }: {
  value?: AppRecord; onClose: () => void; onSave: (data: AppInput) => Promise<void>
}) {
  const [data, setData] = useState<AppInput>(value ?? empty)
  const [tagText, setTagText] = useState(value?.tags.join(', ') ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  function field<K extends keyof AppInput>(key: K, value: AppInput[K]) {
    setData(previous => ({ ...previous, [key]: value }))
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const input = { ...data, tags: [...new Set(tagText.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] }
    const parsed = appInput.safeParse(input)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查输入'); return }
    setSaving(true); setError('')
    try { await onSave(parsed.data); onClose() } catch (error) {
      setError((error as Error).message)
    } finally { setSaving(false) }
  }
  return <Dialog title={value ? '编辑应用' : '添加到我的空间'} onClose={onClose} dismissible={!saving}>
    <form onSubmit={submit} className="editor">
      <div className="icon-picker"><AppIcon icon={data.icon} color={data.color} />
        <div><span className="field-caption">给应用一个熟悉的样子</span>
          <div className="icon-options">{icons.map(icon => <Tooltip label={iconLabels[icon]} key={icon}><button type="button" aria-label={`图标：${iconLabels[icon]}`}
            aria-pressed={data.icon === icon} onClick={() => field('icon', icon)}><AppIcon icon={icon} color={data.color} /></button></Tooltip>)}</div>
          <div className="color-options">{colors.map((color, index) => <Tooltip key={color} label={['森林', '雾蓝', '暖橙', '玫瑰', '岩灰', '青绿'][index]}><button type="button" className={`color-${color}`}
            aria-label={`颜色：${['森林', '雾蓝', '暖橙', '玫瑰', '岩灰', '青绿'][index]}`} aria-pressed={data.color === color} onClick={() => field('color', color)}>{data.color === color && <CheckIcon />}</button></Tooltip>)}</div>
        </div>
      </div>
      <div className="form-grid">
        <label>应用名称<input autoFocus required maxLength={80} placeholder="例如：我的博客" value={data.name} onChange={e => field('name', e.target.value)} /></label>
        <div className="form-field"><span>应用类型</span><Select label="应用类型" value={data.type} onValueChange={value => field('type', value)} options={types.map(type => ({ value: type, label: typeLabels[type] }))} /></div>
        <label className="full">访问地址<input type="url" required maxLength={2048} placeholder="https://example.com" value={data.url} onChange={e => field('url', e.target.value)} /></label>
        <label className="full">一句话介绍<textarea rows={2} maxLength={500} placeholder="它是做什么的？未来的自己会感谢这句话。" value={data.description} onChange={e => field('description', e.target.value)} /></label>
        <label>分类<input maxLength={40} placeholder="例如：工作效率" value={data.category} onChange={e => field('category', e.target.value)} /></label>
        <label>标签<input placeholder="用逗号分隔" value={tagText} onChange={e => setTagText(e.target.value)} /></label>
        <label>首次上线日期 · UTC<input type="date" disabled={Boolean(value)} max={new Date().toISOString().slice(0, 10)} value={data.launchedOn ?? ''} onChange={e => field('launchedOn', e.target.value || null)} />
          <small>{value ? '历史日期不在此处修改，避免影响启用记录。' : '可补录；留空则标记为未上线。'}</small></label>
        <div className="form-field"><span>卡片尺寸</span><Select label="卡片尺寸" value={data.size} onValueChange={value => field('size', value)} options={sizes.map((size, i) => ({ value: size, label: ['小 · 1 × 1', '中 · 2 × 1', '大 · 2 × 2'][i] }))} /></div>
      </div>
      <Checkbox label="收藏到 Dock" checked={data.favorite} onCheckedChange={value => field('favorite', value)} />
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-footer"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>取消</button>
        <button className="button primary" disabled={saving}>{saving ? '正在保存…' : value ? '保存更改' : '添加应用'}</button></div>
    </form>
  </Dialog>
}
