export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    cache: 'no-store',
    method: body === undefined ? 'GET' : method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('gallery-session-expired'))
    }
    throw new Error(result.error || '请求失败，请稍后再试')
  }
  return result
}
