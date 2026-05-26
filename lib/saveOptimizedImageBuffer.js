import { put } from '@vercel/blob'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { buildBlobStorageKey } from './safeBlobUploadFilename.js'

/**
 * 将优化后的图片写入 Vercel Blob（优先）或本地 uploads，返回即梦可用的公网 URL。
 * @param {{ buffer: Buffer, mimeType: string, uploadsDir?: string, req?: { protocol?: string, get?: (h: string) => string | undefined }, storagePrefix?: string, filePrefix?: string }} opts
 * @returns {Promise<{ optimizedImageUrl: string }>}
 */
export async function saveOptimizedImageBuffer({
  buffer,
  mimeType,
  uploadsDir,
  req,
  storagePrefix = 'optimized-images',
  filePrefix = 'opt',
}) {
  const token = (process.env.BLOB_READ_WRITE_TOKEN || '').trim()
  if (token) {
    const key = buildBlobStorageKey(storagePrefix, 'out.png', mimeType)
    const blob = await put(key, buffer, { access: 'public', addRandomSuffix: true })
    return { optimizedImageUrl: blob.url }
  }
  if (uploadsDir) {
    const ext = String(mimeType).includes('png') ? 'png' : 'jpg'
    const name = `${filePrefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`
    fs.mkdirSync(uploadsDir, { recursive: true })
    fs.writeFileSync(path.join(uploadsDir, name), buffer)
    const host = req?.get?.('x-forwarded-host') || req?.get?.('host') || 'localhost:3000'
    const rawProto = req?.get?.('x-forwarded-proto') || req?.protocol || 'http'
    const proto = String(rawProto).replace(/:$/, '')
    const base = `${proto}://${host}`.replace(/\/$/, '')
    return { optimizedImageUrl: `${base}/uploads/${name}` }
  }
  throw new Error('未配置 BLOB_READ_WRITE_TOKEN，且无法写入本地 uploads')
}
