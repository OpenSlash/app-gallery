export const maxIconBytes = 256 * 1024
export const iconContentTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'] as const
export const uploadedIconPath = /^\/api\/v1\/icons\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function validIconContent(data: Uint8Array, type: string): boolean {
  if (!data.length || data.length > maxIconBytes) return false
  const starts = (...values: number[]) => values.every((value, index) => data[index] === value)
  switch (type) {
    case 'image/png': return data.length >= 24 && starts(137, 80, 78, 71, 13, 10, 26, 10)
    case 'image/jpeg': return data.length >= 4 && starts(255, 216, 255) && data.at(-2) === 255 && data.at(-1) === 217
    case 'image/webp': return data.length >= 16 && new TextDecoder().decode(data.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(data.slice(8, 12)) === 'WEBP'
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon': return data.length >= 22 && starts(0, 0, 1, 0) && (data[4] !== 0 || data[5] !== 0)
    case 'image/svg+xml': {
      const text = new TextDecoder('utf-8', { fatal: true })
      let svg: string
      try { svg = text.decode(data).trim() } catch { return false }
      // CSP and sandboxing on retrieval provide the security boundary, even for SVG.
      return /^(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg) &&
        /(?:<\/svg\s*>|\/>)\s*$/i.test(svg) &&
        !/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|<(?:[\w.-]+:)?(?:script|foreignObject|iframe|object|embed|image|use|a)\b|\bon[\w-]+\s*=|(?:href|src)\s*=|url\(\s*["']?\s*(?!#)/i.test(svg)
    }
    default: return false
  }
}
