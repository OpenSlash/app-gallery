import {
  GlobeIcon, CodeIcon, StackIcon, ImageIcon, LayersIcon,
  ReaderIcon, RocketIcon, CubeIcon, GearIcon, DesktopIcon, DashboardIcon,
  LockClosedIcon, Link2Icon, VideoIcon, SpeakerLoudIcon, ArchiveIcon,
} from '@radix-ui/react-icons'
import type { AppInput } from '../shared/model'
import { useState } from 'react'
import { iconUrl as iconUrlSchema } from '../shared/model'

// Keep all interface icons on the same library and sizing conventions.
export {
  MagnifyingGlassIcon, PlusIcon, MixerHorizontalIcon, DashboardIcon, GridIcon,
  StarIcon, StarFilledIcon, ArrowTopRightIcon, DotsHorizontalIcon, Cross2Icon,
  GlobeIcon, CubeIcon, RocketIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, Pencil1Icon,
} from '@radix-ui/react-icons'

const iconMap = {
  globe: GlobeIcon, code: CodeIcon, database: StackIcon, image: ImageIcon,
  cloud: LayersIcon, reader: ReaderIcon, rocket: RocketIcon, cube: CubeIcon,
  gear: GearIcon, desktop: DesktopIcon, dashboard: DashboardIcon, lock: LockClosedIcon,
  link: Link2Icon, video: VideoIcon, music: SpeakerLoudIcon, archive: ArchiveIcon,
}
export const iconLabels: Record<AppInput['icon'], string> = {
  globe: '网站', code: '代码', database: '数据库', image: '图片', cloud: '云服务',
  reader: '文档', rocket: '发布', cube: '应用', gear: '设置', desktop: '桌面',
  dashboard: '仪表盘', lock: '安全', link: '链接', video: '视频', music: '音频', archive: '归档',
}
export function AppIcon({ icon, color, iconUrl = '' }: Pick<AppInput, 'icon' | 'color'> & { iconUrl?: string }) {
  return <ResolvedAppIcon key={iconUrl} icon={icon} color={color} iconUrl={iconUrl} />
}

function ResolvedAppIcon({ icon, color, iconUrl }: Pick<AppInput, 'icon' | 'color' | 'iconUrl'>) {
  const [failed, setFailed] = useState(false)
  const Icon = iconMap[icon] ?? GlobeIcon
  const showImage = iconUrl !== '' && !failed && iconUrlSchema.safeParse(iconUrl).success
  return <span className={`app-icon color-${color}${showImage ? ' has-image' : ''}`}>
    {showImage ? <img src={iconUrl} alt="" aria-hidden="true" referrerPolicy="no-referrer"
      decoding="async" onError={() => setFailed(true)} /> : <Icon aria-hidden="true" />}
  </span>
}
