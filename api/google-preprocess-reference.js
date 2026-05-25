/**
 * POST /api/google-preprocess-reference（Vercel）
 * 与 server/index.js 中同路由逻辑一致。
 */
import axios from 'axios'
import { geminiImageEditFromPrompt } from '../lib/googleGeminiImageEdit.js'
import { getGooglePreprocessPrompt } from '../lib/googlePreprocessPrompts.js'
import { saveOptimizedImageBuffer } from '../lib/saveOptimizedImageBuffer.js'
import { userMessageForGooglePreprocessError } from '../lib/googlePreprocessUserMessage.js'

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  corsHeaders(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim()
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'Gemini not configured',
      message: '请配置 GEMINI_API_KEY。',
    })
  }

  const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId.trim() : ''
  const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : ''
  if (!templateId || !imageUrl) {
    return res.status(400).json({
      error: 'bad request',
      message: '缺少 templateId 或 imageUrl',
    })
  }

  const preprocessPrompt = getGooglePreprocessPrompt(templateId)
  if (!preprocessPrompt) {
    return res.status(400).json({
      error: 'no preprocess for template',
      message: '该模版未配置 Google 预处理',
    })
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    return res.status(400).json({
      error: 'invalid imageUrl',
      message: '图片地址需为 http(s) 链接',
    })
  }

  try {
    const imgResp = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
    })
    const imageBuffer = Buffer.from(imgResp.data)
    const mimeType = (imgResp.headers['content-type'] || '').split(';')[0].trim() || 'image/jpeg'
    if (!mimeType.startsWith('image/')) {
      return res.status(400).json({
        error: 'not an image',
        message: '该 URL 返回的内容不是图片',
      })
    }

    const { buffer: outBuffer, mimeType: outMime } = await geminiImageEditFromPrompt({
      apiKey: GEMINI_API_KEY,
      imageBuffer,
      mimeType,
      prompt: preprocessPrompt,
    })

    const { optimizedImageUrl } = await saveOptimizedImageBuffer({
      buffer: outBuffer,
      mimeType: outMime,
      uploadsDir: undefined,
      req: undefined,
    })

    return res.status(200).json({ optimizedImageUrl })
  } catch (err) {
    console.error('[google-preprocess-reference]', err?.response?.data || err)
    const detail =
      err?.response?.data?.error?.message ||
      err?.response?.data?.error ||
      err?.message ||
      String(err)
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail)
    return res.status(500).json({
      error: 'google preprocess failed',
      message: userMessageForGooglePreprocessError(detailStr),
      detail: detailStr,
    })
  }
}
