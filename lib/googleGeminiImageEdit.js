import axios from 'axios'

const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview'

/** 与封面/即梦一致 3:4；见文档 ImageConfig.aspectRatio */
const DEFAULT_IMAGE_ASPECT_RATIO = '3:4'
/** 文档 imageSize：512 / 1K / 2K / 4K；默认取最小以减轻体积与超时 */
const DEFAULT_IMAGE_SIZE = '512'

/**
 * 使用 Gemini 图片模型（Nano Banana 2 等）做「文本 + 参考图 → 输出图」。
 * @see https://ai.google.dev/gemini-api/docs/image-generation?hl=zh-cn
 *
 * @param {{
 *   apiKey: string
 *   imageBuffer: Buffer
 *   mimeType: string
 *   prompt: string
 *   model?: string
 * }} opts
 * @returns {Promise<{ mimeType: string, buffer: Buffer }>}
 */
export async function geminiImageEditFromPrompt({
  apiKey,
  imageBuffer,
  mimeType,
  prompt,
  model = process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL,
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: imageBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio:
          process.env.GEMINI_IMAGE_ASPECT_RATIO?.trim() || DEFAULT_IMAGE_ASPECT_RATIO,
        imageSize: process.env.GEMINI_IMAGE_SIZE?.trim() || DEFAULT_IMAGE_SIZE,
      },
    },
  }

  const resp = await axios.post(url, body, {
    params: { key: apiKey },
    headers: { 'Content-Type': 'application/json' },
    timeout: 180000,
    validateStatus: () => true,
  })

  if (resp.status >= 400) {
    const msg =
      resp.data?.error?.message ||
      resp.data?.error?.status ||
      (typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data || ''))
    throw new Error(msg || `Gemini HTTP ${resp.status}`)
  }

  const err = resp.data?.error
  if (err) {
    throw new Error(err.message || JSON.stringify(err))
  }

  const parts = resp.data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) {
    throw new Error('Gemini 未返回 candidates 或内容为空')
  }

  for (const part of parts) {
    if (part?.thought) continue
    const inline = part?.inlineData || part?.inline_data
    const data = inline?.data
    const mt = inline?.mimeType || inline?.mime_type || 'image/png'
    if (data && typeof data === 'string') {
      return { mimeType: mt, buffer: Buffer.from(data, 'base64') }
    }
  }

  throw new Error('Gemini 响应中未找到图片数据（inlineData）')
}
