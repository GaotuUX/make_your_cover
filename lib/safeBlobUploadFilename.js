import crypto from 'crypto'
import path from 'path'

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'avif'])

/**
 * 仅使用 ASCII 路径上传 Blob，避免中文 originalFilename 导致公网 URL 路径异常、GET 400。
 * @param {string} prefix 如 uploads
 * @param {string | undefined} originalName 原始文件名（只取扩展名，且仅允许白名单）
 * @param {string | undefined} mimeType 如 image/png
 */
export function buildBlobStorageKey(prefix, originalName, mimeType) {
  let ext = ''
  if (originalName) {
    const raw = path.extname(originalName).replace(/^\./, '').toLowerCase()
    if (raw && /^[a-z0-9]+$/.test(raw)) {
      if (raw === 'jpeg') ext = 'jpg'
      else if (ALLOWED_EXT.has(raw)) ext = raw
    }
  }
  if (!ext && mimeType) {
    const part = String(mimeType).split('/')[1]?.toLowerCase().replace('+xml', '')
    if (part === 'jpeg') ext = 'jpg'
    else if (part && ALLOWED_EXT.has(part)) ext = part
  }
  if (!ext) ext = 'png'

  const id = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
  const p = String(prefix || 'uploads').replace(/\/$/, '')
  return `${p}/${id}.${ext}`
}
