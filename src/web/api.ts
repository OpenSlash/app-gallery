export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    cache: 'no-store',
    method: body === undefined ? 'GET' : method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) {
    if (response.status === 401 && !['/auth/login', '/auth/setup', '/auth/logout', '/auth/session'].includes(path)) {
      window.dispatchEvent(new Event('gallery-session-expired'))
    }
    throw new Error(result.error || '请求失败，请稍后再试')
  }
  return result
}

export async function uploadIcon(file: File): Promise<{ id: string; iconUrl: string }> {
  const response = await fetch('/api/v1/icons', {
    method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  })
  const result = await response.json() as { id: string; iconUrl: string; error?: string }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('gallery-session-expired'))
    throw new Error(result.error || '图标上传失败')
  }
  return result
}
