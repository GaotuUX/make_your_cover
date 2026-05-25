import axios from 'axios'
import { AXIOS_NO_ENV_PROXY } from './axiosNoEnvProxy.js'
import { resolveLocalUploadReferenceForJimeng } from './resolveLocalUploadReferenceForJimeng.js'

/** 与火山文档「输入图」体积上限一致：约 15MB */
const MAX_REF_IMAGE_BYTES = 15 * 1024 * 1024

/**
 * 先走本机 uploads 转 base64；对公网 URL 默认在服务端拉取再转 base64，避免即梦云端拉不到 Vercel Blob 等导致 50500。
 * 设 `JIMENG_FETCH_REMOTE_REF_IMAGES=false` 可恢复为仅传 `image_urls`（由火山侧拉）。
 *
 * @param {string[] | undefined} refImageUrls
 * @param {{ uploadsDir?: string }} opts
 * @returns {Promise<{ imageUrls?: string[], binaryDataBase64?: string[] }>}
 */
export async function resolveJimengReferenceImagesAsync(refImageUrls, { uploadsDir } = {}) {
  if (!refImageUrls?.length) return {}

  const local = resolveLocalUploadReferenceForJimeng(refImageUrls, { uploadsDir })
  if (local.binaryDataBase64?.length) {
    return local
  }
  if (!local.imageUrls?.length) {
    return {}
  }

  const skipFetch = (process.env.JIMENG_FETCH_REMOTE_REF_IMAGES || 'true').trim().toLowerCase() === 'false'
  if (skipFetch) {
    return { imageUrls: local.imageUrls }
  }

  const binaryDataBase64 = []
  for (const url of local.imageUrls) {
    const u = String(url).trim()
    if (!/^https?:\/\//i.test(u)) {
      throw new Error('参考图地址需为 http(s) 链接')
    }
    const resp = await axios.get(u, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: MAX_REF_IMAGE_BYTES,
      maxBodyLength: MAX_REF_IMAGE_BYTES,
      ...AXIOS_NO_ENV_PROXY,
    })
    const buf = Buffer.from(resp.data)
    if (buf.length > MAX_REF_IMAGE_BYTES) {
      throw new Error('参考图超过 15MB')
    }
    const ct = (resp.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    if (ct && !ct.startsWith('image/')) {
      throw new Error('参考图 URL 返回的不是图片')
    }
    binaryDataBase64.push(buf.toString('base64'))
  }
  return { binaryDataBase64 }
}

/**
 * 将解析结果写入 CVSync2AsyncSubmitTask body（image_urls 与 binary_data_base64 二选一）。
 * 即梦 4.0 / 4.6 均接受 string[]；统一数组可避免单张参考图被压成 string
 * 后触发 50207 invalid binary_data_base64 type=string。
 */
export function applyResolvedRefToSubmitBody(submitBody, resolved) {
  if (!resolved?.binaryDataBase64?.length && !resolved?.imageUrls?.length) return
  if (resolved.binaryDataBase64?.length) {
    submitBody.binary_data_base64 = resolved.binaryDataBase64
  } else if (resolved.imageUrls?.length) {
    submitBody.image_urls = resolved.imageUrls
  }
}
