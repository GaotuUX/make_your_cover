import fs from 'fs'
import path from 'path'

/**
 * 将本机 /uploads/ 下的参考图转为 base64，供即梦 CVSync2AsyncSubmitTask 使用
 *（与 image_urls 二选一；云端无法访问 localhost URL）。
 * @param {string[]} refImageUrls
 * @param {{ uploadsDir?: string }} opts
 * @returns {{ imageUrls?: string[], binaryDataBase64?: string[] }}
 */
export function resolveLocalUploadReferenceForJimeng(refImageUrls, { uploadsDir } = {}) {
  if (!refImageUrls?.length) return {}

  if (!uploadsDir) {
    return { imageUrls: refImageUrls }
  }

  const imageUrls = []
  const binaryDataBase64 = []

  for (const raw of refImageUrls) {
    const u = String(raw).trim()
    const localFile = tryResolveLocalUploadFile(u, uploadsDir)
    if (localFile) {
      const buf = fs.readFileSync(localFile)
      binaryDataBase64.push(buf.toString('base64'))
    } else {
      imageUrls.push(u)
    }
  }

  if (binaryDataBase64.length && imageUrls.length) {
    throw new Error('参考图不能混用本地上传地址与公网 URL，请统一来源')
  }
  if (binaryDataBase64.length) {
    return { binaryDataBase64 }
  }
  return { imageUrls }
}

/**
 * @param {import('fs').PathLike} uploadsDir
 */
function tryResolveLocalUploadFile(urlString, uploadsDir) {
  let parsed
  try {
    parsed = new URL(urlString)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null

  const host = parsed.hostname
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    return null
  }

  const name = filenameFromUploadsPathname(parsed.pathname)
  if (!name || name.includes('..')) return null

  const full = path.join(uploadsDir, name)
  const resolved = path.resolve(full)
  const uploadsResolved = path.resolve(uploadsDir)
  if (!resolved.startsWith(uploadsResolved + path.sep) && resolved !== uploadsResolved) {
    return null
  }
  if (!fs.existsSync(full)) return null
  return full
}

function filenameFromUploadsPathname(pathname) {
  const m = pathname.match(/^\/uploads\/([^/]+)$/)
  return m ? m[1] : null
}

/**
 * 写入 submitBody:仅设置 image_urls 或 binary_data_base64 之一。
 * 统一使用 string[]，避免不同即梦 req_key 对单张图 string/array 要求不一致。
 */
export function applyJimengReferenceToSubmitBody(submitBody, refImageUrls, { uploadsDir } = {}) {
  if (!refImageUrls?.length) return
  const resolved = resolveLocalUploadReferenceForJimeng(refImageUrls, { uploadsDir })
  if (resolved.binaryDataBase64?.length) {
    submitBody.binary_data_base64 = resolved.binaryDataBase64
  } else if (resolved.imageUrls?.length) {
    submitBody.image_urls = resolved.imageUrls
  }
}
