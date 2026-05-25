import { saveOptimizedImageBuffer } from './saveOptimizedImageBuffer.js'

export const DEFAULT_JIMENG_REFERENCE_PREPROCESS_PROMPT =
  '写实、人像摄影风格，穿着白色衬衫的人物，经典证件照构图，表情自然温和，浅灰色背景，专业肖像摄影，8K高清画质，柔和均匀光线，修正表情，自然微笑，人物肩膀平齐眼神自然，使用佳能EF 50mm f/1.2L镜头拍摄'

/**
 * 即梦可能返回公网 URL，也可能返回 data URL。后续即梦正式生成只接受可解析的
 * http(s) URL，因此 data URL 需要先落到 Blob 或本地 uploads。
 *
 * @param {{ imageUrl: string, uploadsDir?: string, req?: { protocol?: string, get?: (h: string) => string | undefined } }} opts
 * @returns {Promise<{ optimizedImageUrl: string }>}
 */
export async function materializeJimengPreprocessImageUrl({ imageUrl, uploadsDir, req }) {
  const raw = (imageUrl || '').trim()
  if (/^https?:\/\//i.test(raw)) {
    return { optimizedImageUrl: raw }
  }

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('即梦预处理未返回可用图片 URL')
  }

  const [, mimeType, data] = match
  const buffer = Buffer.from(data, 'base64')
  return saveOptimizedImageBuffer({
    buffer,
    mimeType,
    uploadsDir,
    req,
    storagePrefix: 'jimeng-preprocess',
    filePrefix: 'jp',
  })
}
