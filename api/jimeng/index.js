import axios from 'axios'
import path from 'path'
import { volcPost } from './volc.js'
import {
  applyResolvedRefToSubmitBody,
  resolveJimengReferenceImagesAsync,
} from '../../lib/resolveJimengReferenceForSubmit.js'
import {
  JIMENG_POLL_INTERVAL_MS,
  JIMENG_POLL_MAX_ITERATIONS,
} from '../../lib/jimengPollConstants.js'
import { extractVolcRequestId } from '../../lib/extractVolcRequestId.js'

// Config from env (Vercel exposes process.env)
const VISUAL_HOST = process.env.VISUAL_HOST || 'visual.volcengineapi.com'
const VISUAL_BASE_URL = `https://${VISUAL_HOST}`
const JIMENG_REQ_KEY = process.env.JIMENG_REQ_KEY

const JIMENG_ACCESS_KEY_ID = process.env.JIMENG_ACCESS_KEY_ID
const JIMENG_SECRET_ACCESS_KEY = process.env.JIMENG_SECRET_ACCESS_KEY
const JIMENG_REGION = process.env.JIMENG_REGION || 'cn-beijing'
const JIMENG_SERVICE = process.env.JIMENG_SERVICE || 'cv'
const JIMENG_API_KEY = process.env.JIMENG_API_KEY

function jimengLocalUploadsDir() {
  const p = (process.env.JIMENG_LOCAL_UPLOADS_DIR || '').trim()
  if (!p) return undefined
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 说明：不要在 export const config 的对象字面量内写 /** */，Vercel 打包器会报 Unhandled type: "ColonToken"
export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { prompt, imageUrls } = req.body || {}
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' })
  }

  const hasBearer = Boolean(JIMENG_API_KEY)
  const hasAKSK = Boolean(JIMENG_ACCESS_KEY_ID && JIMENG_SECRET_ACCESS_KEY && JIMENG_SERVICE)
  if (!hasBearer && !hasAKSK) {
    return res.status(500).json({
      error: 'No auth configured on server',
      hint: '请在 Vercel 环境变量中配置 JIMENG_API_KEY 或 JIMENG_ACCESS_KEY_ID/JIMENG_SECRET_ACCESS_KEY/JIMENG_SERVICE。',
    })
  }
  if (!JIMENG_REQ_KEY) {
    return res.status(500).json({
      error: 'JIMENG_REQ_KEY is not configured',
      hint: '请在 Vercel 环境变量中设置 JIMENG_REQ_KEY。',
    })
  }

  try {
    const useAKSK = hasAKSK
    const submitUrl = `${VISUAL_BASE_URL}/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31`

    const userPrompt = (prompt || '').trim()
    const finalPrompt = userPrompt

    const submitBody = {
      req_key: JIMENG_REQ_KEY,
      prompt: finalPrompt,
      scale: 0.5,
      width: 1080,
      height: 1440,
      n: 4,
    }
    const resolvedRef = await resolveJimengReferenceImagesAsync(
      Array.isArray(imageUrls) ? imageUrls : undefined,
      { uploadsDir: jimengLocalUploadsDir() },
    )
    applyResolvedRefToSubmitBody(submitBody, resolvedRef)

    const submitResp = await volcPost({
      url: submitUrl,
      payload: JSON.stringify(submitBody),
      useAKSK,
    })

    const taskId =
      submitResp.data?.Result?.TaskId ||
      submitResp.data?.Result?.task_id ||
      submitResp.data?.result?.task_id ||
      submitResp.data?.data?.task_id

    const submitRequestId = extractVolcRequestId(submitResp)
    console.log('[JiMeng] CVSync2AsyncSubmitTask', {
      task_id: taskId || null,
      request_id: submitRequestId || null,
      jimengModel: 'image_4_0',
      req_key: JIMENG_REQ_KEY,
    })

    if (!taskId) {
      return res.status(500).json({
        error: 'No task_id returned from CVSync2AsyncSubmitTask',
        raw: submitResp.data,
      })
    }

    const getUrl = `${VISUAL_BASE_URL}/?Action=CVSync2AsyncGetResult&Version=2022-08-31`
    let last = null

    for (let i = 0; i < JIMENG_POLL_MAX_ITERATIONS; i++) {
      const getBody = {
        req_key: JIMENG_REQ_KEY,
        task_id: taskId,
      }
      const getResp = await volcPost({
        url: getUrl,
        payload: JSON.stringify(getBody),
        useAKSK,
      })
      last = getResp.data

      const b64List =
        getResp.data?.data?.binary_data_base64 ||
        getResp.data?.Result?.binary_data_base64 ||
        getResp.data?.Result?.BinaryDataBase64

      if (Array.isArray(b64List) && b64List.length > 0) {
        const urls = b64List
          .filter((b) => typeof b === 'string' && b)
          .map((b) => `data:image/png;base64,${b}`)
        if (urls.length > 0) {
          return res.json({ imageUrls: urls, imageUrl: urls[0], taskId })
        }
      }

      let imgUrls =
        getResp.data?.Result?.ImageUrls ||
        getResp.data?.Result?.Images?.map((it) => it?.Url).filter(Boolean) ||
        getResp.data?.Result?.data?.map((it) => it?.url).filter(Boolean) ||
        getResp.data?.result?.data?.map((it) => it?.url).filter(Boolean)

      if (!imgUrls || imgUrls.length === 0) {
        const singleUrl =
          getResp.data?.Result?.ImageURL ||
          getResp.data?.Result?.ImageUrl ||
          getResp.data?.Result?.Images?.[0]?.Url ||
          getResp.data?.Result?.data?.[0]?.url ||
          getResp.data?.result?.data?.[0]?.url
        if (singleUrl) imgUrls = [singleUrl]
      }

      if (imgUrls && imgUrls.length > 0) {
        return res.json({ imageUrls: imgUrls, imageUrl: imgUrls[0], taskId })
      }

      const status =
        getResp.data?.Result?.Status ||
        getResp.data?.Result?.status ||
        getResp.data?.Result?.TaskStatus ||
        getResp.data?.result?.status
      const errMsg = getResp.data?.Result?.Error || getResp.data?.Result?.error
      if (status && String(status).toLowerCase().includes('fail')) {
        return res.status(500).json({ error: 'JiMeng task failed', status, errMsg, taskId, raw: last })
      }

      await sleep(JIMENG_POLL_INTERVAL_MS)
    }

    const lastB64List =
      last?.data?.binary_data_base64 ||
      last?.Result?.binary_data_base64 ||
      last?.Result?.BinaryDataBase64
    if (Array.isArray(lastB64List) && lastB64List.length > 0) {
      const urls = lastB64List
        .filter((b) => typeof b === 'string' && b)
        .map((b) => `data:image/png;base64,${b}`)
      if (urls.length > 0) {
        return res.json({ imageUrls: urls, imageUrl: urls[0], taskId })
      }
    }

    return res.status(504).json({
      error: 'JiMeng task timeout',
      taskId,
      raw: last,
      hint: '任务可能仍在运行，请稍后重试。',
    })
  } catch (error) {
    console.error('[JiMeng] request error', error?.response?.data || error)
    return res.status(500).json({
      error: 'JiMeng request failed',
      detail: error?.response?.data || String(error),
    })
  }
}
