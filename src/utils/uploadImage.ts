import { showApiErrorToast } from '../components/Toast/ToastProvider'

/** 与 vite.config.ts 中 API_PROXY_TARGET 默认端口一致 */
const DEFAULT_DEV_BACKEND_ORIGIN = 'http://localhost:3000'

/** 与 App 中一致:VITE_API_URL 指向后端根地址 */
export function getApiBase(): string {
  return (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
}

/**
 * 预览用图片地址:相对路径 `/uploads/...` 在仅开 Vite、未配 VITE_API_URL 时，
 * 若直接作 img src 会打到 5173，Vite 会报 Not a valid path；应指向后端静态或走代理。
 */
export function resolvePreviewImageUrl(url: string): string {
  const u = (url || '').trim()
  if (!u) return u
  if (/^(https?:|data:|blob:)/i.test(u)) return u
  if (u.startsWith('//')) return `https:${u}`
  if (u.startsWith('/')) {
    const base = getApiBase() || DEFAULT_DEV_BACKEND_ORIGIN
    return `${base.replace(/\/$/, '')}${u}`
  }
  return u
}

export async function uploadImageAndGetUrl(file: File, apiBase = getApiBase()): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${apiBase}/api/upload-image`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    showApiErrorToast({ title: '上传图片失败', data, httpStatus: res.status })
    throw new Error('api_error')
  }

  const data = (await res.json()) as { url?: string }
  const url = data?.url
  if (!url || typeof url !== 'string') {
    throw new Error('上传成功但未返回 URL')
  }
  return url
}
