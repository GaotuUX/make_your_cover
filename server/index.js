import express from 'express'
import cors from 'cors'
import axios from 'axios'
import { buildScheme2DoubaoPrompt } from '../lib/doubaoScheme2.js'
import { extractDoubaoResponseText } from '../lib/extractDoubaoResponseText.js'
import { logDoubaoUsage } from '../lib/logDoubaoUsage.js'
import { summarizeUpstreamErrorForHint } from '../lib/formatApiErrorDetail.js'
import { normalizeScheme2ImageUrls } from '../lib/normalizeScheme2ImageUrls.js'
import { buildJimengSyncAsyncSubmitBody } from '../lib/buildJimengSubmitBody.js'
import {
  JIMENG_POLL_INTERVAL_MS,
  JIMENG_POLL_MAX_ITERATIONS,
} from '../lib/jimengPollConstants.js'
import {
  invalidJimengModelResponseHint,
  isAllowedJimengImageModel,
  missingJimengReqKeyHint,
  resolveJimengReqKey,
} from '../lib/jimengResolveReqKey.js'
import { AXIOS_NO_ENV_PROXY } from '../lib/axiosNoEnvProxy.js'
import { extractVolcRequestId } from '../lib/extractVolcRequestId.js'
import {
  DEFAULT_JIMENG_REFERENCE_PREPROCESS_PROMPT,
  materializeJimengPreprocessImageUrl,
} from '../lib/jimengReferencePreprocess.js'
import { put } from '@vercel/blob'
import { buildBlobStorageKey } from '../lib/safeBlobUploadFilename.js'
import dotenv from 'dotenv'
import crypto from 'crypto'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'

// 解决 ESM 下 __dirname 不存在的问题（须先于 dotenv，以便固定加载 server/.env）
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '.env') })

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
// 上传垫图会带 base64，默认 100kb 很容易触发 PayloadTooLargeError
app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))

// 静态目录用于访问上传的图片，启动时确保目录存在
const uploadsDir = path.join(__dirname, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })
app.use('/uploads', express.static(uploadsDir))

// 内存接收文件后上传至 Vercel Blob，返回公网 URL（即梦可拉取）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
})

// 统一处理 body 过大的错误，返回 JSON，避免前端“无感”
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request entity too large',
      hint: '垫图过大，请换小一点的图片（建议 < 5MB）或降低分辨率后再上传。',
    })
  }
  next(err)
})

// 即梦 AK/SK（火山引擎签名鉴权）
// 在 server 目录下创建 .env，示例:
// JIMENG_ACCESS_KEY_ID=AKLT...
// JIMENG_SECRET_ACCESS_KEY=xxxx(base64形式也可，按控制台显示原样填写)
// JIMENG_REGION=cn-beijing
// JIMENG_SERVICE=iam(示例)  // 即梦图片生成需要填“对应服务名”，以即梦接口文档为准
const JIMENG_ACCESS_KEY_ID = process.env.JIMENG_ACCESS_KEY_ID
const JIMENG_SECRET_ACCESS_KEY = process.env.JIMENG_SECRET_ACCESS_KEY
const JIMENG_REGION = process.env.JIMENG_REGION || 'cn-beijing'
const JIMENG_SERVICE = process.env.JIMENG_SERVICE || 'cv'

// 兼容 Bearer API Key（如果你走的是 Ark/OpenAI 风格接口，可以只配置这个）
const JIMENG_API_KEY = process.env.JIMENG_API_KEY

// 可配置的接口参数，按官方文档补全 / 调整
// 文档参考:https://www.volcengine.com/docs/85621/1820192
// 即梦图片生成 4.0 走火山引擎 Visual OpenAPI（你提供的 host + Action/Version）
const VISUAL_HOST = process.env.VISUAL_HOST || 'visual.volcengineapi.com'
const VISUAL_BASE_URL = `https://${VISUAL_HOST}`
// 必填:具体能力的 req_key（即梦图片生成的 req_key 以即梦接口文档为准）
const JIMENG_REQ_KEY = process.env.JIMENG_REQ_KEY
/** 即梦文生图 3.0，与 4.0 共用 AK/SK；文档 https://www.volcengine.com/docs/85621/1616429?lang=zh */
const JIMENG_REQ_KEY_T2I_V30 =
  (process.env.JIMENG_REQ_KEY_T2I_V30 || '').trim() || 'jimeng_t2i_v30'

// 豆包 API（用于随机生成文案）
// Responses API 文档:https://ark.cn-beijing.volces.com/api/v3/responses
// Chat Completions:https://ark.cn-beijing.volces.com/api/v3/chat/completions
const DOUBAO_API_KEY = (process.env.DOUBAO_API_KEY || '').trim()
const DOUBAO_API_URL =
  (process.env.DOUBAO_API_URL || '').trim() ||
  'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const DOUBAO_MODEL =
  (process.env.DOUBAO_MODEL || '').trim() || 'doubao-seed-1-6-flash-250828'

const SYSTEM_SCHEME2_DOUBAO =
  '你是图生图提示词专家。用户消息中已给出「封面主题」「标题」「副标题」与「封面模版 prompt」四部分；你必须综合这四项生成**一条**中文画面描述正文，不要复述字段名，不要前言、分点、markdown。'

if (
  !JIMENG_API_KEY &&
  !(JIMENG_ACCESS_KEY_ID && JIMENG_SECRET_ACCESS_KEY && JIMENG_SERVICE) // AK/SK 签名
) {
  console.warn(
    '[JiMeng] 未检测到可用鉴权信息。请配置 JIMENG_API_KEY（Bearer）或配置 JIMENG_ACCESS_KEY_ID/JIMENG_SECRET_ACCESS_KEY/JIMENG_SERVICE（AKSK签名）。',
  )
}
if (!JIMENG_REQ_KEY) {
  console.warn(
    '[JiMeng] 未配置 JIMENG_REQ_KEY（即梦能力 req_key），封面生成将无法正确调用 CVSync2AsyncSubmitTask。',
  )
}

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function hmac(key, content, encoding) {
  return crypto.createHmac('sha256', key).update(content).digest(encoding)
}

function toAmzDate(date) {
  // YYYYMMDDTHHMMSSZ
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function canonicalQueryString(urlObj) {
  const pairs = []
  for (const [k, v] of urlObj.searchParams.entries()) {
    pairs.push([encodeURIComponent(k), encodeURIComponent(v)])
  }
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  return pairs.map(([k, v]) => `${k}=${v}`).join('&')
}

function buildVolcAuthorization({
  accessKeyId,
  secretAccessKey,
  region,
  service,
  method,
  url,
  headersToSign,
  payload,
  xDate,
}) {
  const urlObj = new URL(url)
  const canonicalURI = urlObj.pathname || '/'
  const canonicalQS = canonicalQueryString(urlObj)

  // canonical headers: lowercase keys, trim spaces, sort by key asc, join with \n and end with \n
  const canonicalHeaderEntries = Object.entries(headersToSign)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim()])
    .sort((a, b) => a[0].localeCompare(b[0]))

  const canonicalHeaders = canonicalHeaderEntries.map(([k, v]) => `${k}:${v}\n`).join('')
  const signedHeaders = canonicalHeaderEntries.map(([k]) => k).join(';')
  const hashedPayload = sha256Hex(payload ?? '')

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalURI,
    canonicalQS,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n')

  const shortDate = xDate.slice(0, 8)
  const credentialScope = `${shortDate}/${region}/${service}/request`
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(secretAccessKey, shortDate)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  return `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** SSE:每行一条事件，便于前端即时展示过程图 */
function writeSse(res, eventName, payload) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
  res.write(`event: ${eventName}\n`)
  res.write(`data: ${data}\n\n`)
}

function canWriteSse(res) {
  return !res.writableEnded && !res.destroyed
}

const jimengStreamQueue = []
let jimengStreamQueueRunning = false
let jimengStreamQueueSeq = 0

/**
 * 进程内 FIFO 队列：只保证单个 Node/Vercel 实例内同一时间 1 个即梦生成任务。
 * 如需 Vercel 多实例全局唯一，需要改用 Redis/Upstash 等分布式队列或锁。
 */
function enqueueJimengStreamJob(run) {
  const job = {
    id: ++jimengStreamQueueSeq,
    started: false,
    canceled: false,
    run,
  }
  const promise = new Promise((resolve, reject) => {
    job.resolve = resolve
    job.reject = reject
  })
  jimengStreamQueue.push(job)
  return {
    job,
    position: jimengStreamQueue.length + (jimengStreamQueueRunning ? 1 : 0),
    promise,
  }
}

function cancelQueuedJimengStreamJob(job) {
  if (job.started) {
    job.canceled = true
    return false
  }
  const index = jimengStreamQueue.indexOf(job)
  if (index === -1) return false
  jimengStreamQueue.splice(index, 1)
  job.canceled = true
  job.resolve?.({ canceled: true })
  return true
}

async function drainJimengStreamQueue() {
  if (jimengStreamQueueRunning) return
  jimengStreamQueueRunning = true
  try {
    while (jimengStreamQueue.length > 0) {
      const job = jimengStreamQueue.shift()
      if (!job || job.canceled) {
        job?.resolve?.({ canceled: true })
        continue
      }
      job.started = true
      try {
        await job.run()
        job.resolve?.({ canceled: false })
      } catch (err) {
        job.reject?.(err)
      }
    }
  } finally {
    jimengStreamQueueRunning = false
    if (jimengStreamQueue.length > 0) {
      drainJimengStreamQueue()
    }
  }
}

async function volcPost({ url, payload, useAKSK }) {
  const xDate = toAmzDate(new Date())
  const host = new URL(url).host
  const headers = {
    'Content-Type': 'application/json',
    Host: host,
  }

  if (useAKSK) {
    const auth = buildVolcAuthorization({
      accessKeyId: JIMENG_ACCESS_KEY_ID,
      secretAccessKey: JIMENG_SECRET_ACCESS_KEY,
      region: JIMENG_REGION,
      service: JIMENG_SERVICE,
      method: 'POST',
      url,
      headersToSign: {
        host,
        'x-date': xDate,
      },
      payload,
      xDate,
    })
    headers['X-Date'] = xDate
    headers.Authorization = auth
  } else {
    headers.Authorization = `Bearer ${JIMENG_API_KEY}`
  }

  return axios.post(url, payload, { headers, timeout: 120000, ...AXIOS_NO_ENV_PROXY })
}

/**
 * 即梦:提交任务并轮询，返回多张图 URL（或 data URL）
 * @param {{ prompt: string, n?: number, imageUrls?: string[], reqKey?: string, uploadsDir?: string, jimengModel?: string, omitPromptSuffix?: boolean }} opts
 * @param opts.reqKey 不传则使用环境变量 JIMENG_REQ_KEY
 * @param opts.uploadsDir 存在时，将 localhost /uploads/ 参考图改为 binary_data_base64 提交（即梦云端无法拉 localhost）
 * @param opts.omitPromptSuffix 保留参数兼容；后缀已在前端拼接，后端始终使用 prompt 原文
 */
async function runJimengGenerate({
  prompt,
  n = 4,
  imageUrls: refImageUrls,
  reqKey: reqKeyOpt,
  uploadsDir: uploadsDirOpt,
  jimengModel,
  omitPromptSuffix,
}) {
  const hasBearer = Boolean(JIMENG_API_KEY)
  const hasAKSK = Boolean(JIMENG_ACCESS_KEY_ID && JIMENG_SECRET_ACCESS_KEY && JIMENG_SERVICE)
  if (!hasBearer && !hasAKSK) {
    throw new Error('No JiMeng auth')
  }
  const reqKey = reqKeyOpt || JIMENG_REQ_KEY
  if (!reqKey) {
    throw new Error('No JIMENG_REQ_KEY')
  }
  const useAKSK = hasAKSK
  const submitUrl = `${VISUAL_BASE_URL}/?Action=CVSync2AsyncSubmitTask&Version=2022-08-31`
  const userPrompt = (prompt || '').trim()
  const finalPrompt = userPrompt
  /** 与前端四宫格一致，单次最多 4 张；返回结果再截断，避免接口多返图 */
  const count = Math.min(4, Math.max(1, Number(n) || 4))
  const takeUrls = (urls) => (Array.isArray(urls) && urls.length > 0 ? urls.slice(0, count) : urls)
  const submitBody = await buildJimengSyncAsyncSubmitBody({
    reqKey,
    finalPrompt,
    n,
    refImageUrls,
    uploadsDir: uploadsDirOpt,
    jimengModel,
  })

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
    jimengModel: jimengModel || 'image_4_0',
    req_key: reqKey,
  })

  if (!taskId) {
    throw new Error('No task_id returned from CVSync2AsyncSubmitTask')
  }

  const getUrl = `${VISUAL_BASE_URL}/?Action=CVSync2AsyncGetResult&Version=2022-08-31`
  let last = null
  for (let i = 0; i < JIMENG_POLL_MAX_ITERATIONS; i++) {
    const getBody = {
      req_key: reqKey,
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
      const imageUrls = takeUrls(
        b64List
          .filter((b) => typeof b === 'string' && b)
          .map((b) => `data:image/png;base64,${b}`),
      )
      if (imageUrls.length > 0) {
        return { imageUrls, taskId }
      }
    }

    let imageUrls =
      getResp.data?.Result?.ImageUrls ||
      getResp.data?.Result?.Images?.map((it) => it?.Url).filter(Boolean) ||
      getResp.data?.Result?.data?.map((it) => it?.url).filter(Boolean) ||
      getResp.data?.result?.data?.map((it) => it?.url).filter(Boolean)

    if (!imageUrls || imageUrls.length === 0) {
      const singleUrl =
        getResp.data?.Result?.ImageURL ||
        getResp.data?.Result?.ImageUrl ||
        getResp.data?.Result?.Images?.[0]?.Url ||
        getResp.data?.Result?.data?.[0]?.url ||
        getResp.data?.result?.data?.[0]?.url

      if (singleUrl) {
        imageUrls = [singleUrl]
      }
    }

    if (imageUrls && imageUrls.length > 0) {
      return { imageUrls: takeUrls(imageUrls), taskId }
    }

    const status =
      getResp.data?.Result?.Status ||
      getResp.data?.Result?.status ||
      getResp.data?.Result?.TaskStatus ||
      getResp.data?.result?.status
    const errMsg = getResp.data?.Result?.Error || getResp.data?.Result?.error
    if (status && String(status).toLowerCase().includes('fail')) {
      throw new Error(errMsg || 'JiMeng task failed')
    }

    await sleep(JIMENG_POLL_INTERVAL_MS)
  }

  const lastB64List =
    last?.data?.binary_data_base64 ||
    last?.Result?.binary_data_base64 ||
    last?.Result?.BinaryDataBase64
  if (Array.isArray(lastB64List) && lastB64List.length > 0) {
    const imageUrls = takeUrls(
      lastB64List
        .filter((b) => typeof b === 'string' && b)
        .map((b) => `data:image/png;base64,${b}`),
    )
    if (imageUrls.length > 0) {
      return { imageUrls, taskId }
    }
  }

  throw new Error('JiMeng task timeout')
}

/**
 * 单次即梦任务 n=4，返回 4 张候选图。
 * @param {{ prompt: string, imageUrls?: string[], reqKey?: string, onEachImage?: (ev: { index: number, url: string, taskId: string }) => void, jimengModel?: string, omitPromptSuffix?: boolean }} opts
 * @returns {Promise<{ imageUrls: string[], taskIds: string[] }>}
 */
async function runJimengGenerateBatchFour({
  prompt,
  imageUrls: refImageUrls,
  reqKey,
  uploadsDir: uploadsDirOpt,
  onEachImage,
  jimengModel,
  omitPromptSuffix,
}) {
  const reqKeyResolved = reqKey || JIMENG_REQ_KEY
  if (!reqKeyResolved) {
    throw new Error('No JIMENG_REQ_KEY')
  }
  const { imageUrls: urls, taskId } = await runJimengGenerate({
    prompt,
    n: 4,
    imageUrls: refImageUrls,
    reqKey: reqKeyResolved,
    uploadsDir: uploadsDirOpt,
    jimengModel,
    omitPromptSuffix,
  })
  const four = Array.isArray(urls) ? urls.slice(0, 4) : []
  if (four.length < 4 || four.some((u) => !u || typeof u !== 'string')) {
    throw new Error('即梦单次任务未返回 4 张有效图片')
  }
  if (typeof onEachImage === 'function') {
    four.forEach((url, index) => {
      onEachImage({ index, url, taskId })
    })
  }
  return { imageUrls: four, taskIds: [taskId] }
}

/**
 * 测试/批处理用:串行提交 4 个单图任务，避免触发即梦并发限制。
 * 最终仍返回 4 张图，避免阻塞到单个 n=4 任务整体完成。
 */
async function runJimengGenerateFourSingles({
  prompt,
  imageUrls: refImageUrls,
  reqKey,
  uploadsDir: uploadsDirOpt,
  onEachImage,
  shouldContinue,
  jimengModel,
  omitPromptSuffix,
}) {
  const reqKeyResolved = reqKey || JIMENG_REQ_KEY
  if (!reqKeyResolved) {
    throw new Error('No JIMENG_REQ_KEY')
  }

  const results = new Array(4)
  const taskIds = new Array(4)
  for (let index = 0; index < 4; index++) {
    if (typeof shouldContinue === 'function' && !shouldContinue()) {
      throw new Error('JiMeng stream canceled')
    }
    const { imageUrls: urls, taskId } = await runJimengGenerate({
      prompt,
      n: 1,
      imageUrls: refImageUrls,
      reqKey: reqKeyResolved,
      uploadsDir: uploadsDirOpt,
      jimengModel,
      omitPromptSuffix,
    })
    const url = Array.isArray(urls) ? urls[0] : ''
    if (!url || typeof url !== 'string') {
      throw new Error(`即梦第 ${index + 1} 张未返回有效图片`)
    }
    results[index] = url
    taskIds[index] = taskId
    if (typeof onEachImage === 'function') {
      onEachImage({ index, url, taskId })
    }
  }

  return { imageUrls: results, taskIds }
}

async function runJimengGenerateSingle({
  prompt,
  imageUrls: refImageUrls,
  reqKey,
  uploadsDir: uploadsDirOpt,
  onImage,
  shouldContinue,
  jimengModel,
  omitPromptSuffix,
}) {
  const reqKeyResolved = reqKey || JIMENG_REQ_KEY
  if (!reqKeyResolved) {
    throw new Error('No JIMENG_REQ_KEY')
  }
  if (typeof shouldContinue === 'function' && !shouldContinue()) {
    throw new Error('JiMeng stream canceled')
  }

  const { imageUrls: urls, taskId } = await runJimengGenerate({
    prompt,
    n: 1,
    imageUrls: refImageUrls,
    reqKey: reqKeyResolved,
    uploadsDir: uploadsDirOpt,
    jimengModel,
    omitPromptSuffix,
  })
  const url = Array.isArray(urls) ? urls[0] : ''
  if (!url || typeof url !== 'string') {
    throw new Error('即梦未返回有效图片')
  }
  if (typeof onImage === 'function') {
    onImage({ index: 0, url, taskId })
  }
  return { imageUrl: url, taskId, taskIds: [taskId] }
}

// ========== 豆包 API（随机生成文案）==========
// Responses API:https://ark.cn-beijing.volces.com/api/v3/responses
// Chat Completions:https://ark.cn-beijing.volces.com/api/v3/chat/completions
if (!DOUBAO_API_KEY) {
  console.warn('[Doubao] 未配置 DOUBAO_API_KEY，随机生成文案功能不可用。')
}

function extractDoubaoStreamDelta(data) {
  const choice = data?.choices?.[0]
  const delta = choice?.delta?.content
  if (typeof delta === 'string') return delta
  if (Array.isArray(delta)) {
    return delta
      .map((part) => {
        if (typeof part === 'string') return part
        if (part?.text != null) return String(part.text)
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .join('')
  }
  const responseDelta = data?.delta
  if (typeof responseDelta === 'string') return responseDelta
  if (data?.type === 'response.output_text.delta' && typeof data?.delta === 'string') {
    return data.delta
  }
  if (typeof data?.output_text === 'string') return data.output_text
  return ''
}

async function streamDoubaoResponseToClient(resp, res) {
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  for await (const chunk of resp.data) {
    buffer += decoder.decode(chunk, { stream: true })
    const blocks = buffer.split(/\n\n+/)
    buffer = blocks.pop() || ''

    for (const block of blocks) {
      for (const line of block.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const raw = trimmed.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        let data
        try {
          data = JSON.parse(raw)
        } catch {
          continue
        }
        const delta = extractDoubaoStreamDelta(data)
        if (!delta) continue
        text += delta
        writeSse(res, 'delta', { text: delta })
      }
    }
  }

  if (buffer.trim()) {
    const raw = buffer
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'))
      ?.slice(5)
      .trim()
    if (raw && raw !== '[DONE]') {
      try {
        const data = JSON.parse(raw)
        const delta = extractDoubaoStreamDelta(data)
        if (delta) {
          text += delta
          writeSse(res, 'delta', { text: delta })
        }
      } catch {
        // Ignore incomplete trailing stream data.
      }
    }
  }

  writeSse(res, 'done', { text })
}

app.post('/api/doubao', async (req, res) => {
  if (!DOUBAO_API_KEY) {
    return res.status(500).json({
      error: 'Doubao not configured',
      hint: '请在 server/.env 中配置 DOUBAO_API_KEY（火山方舟 API Key）并重启后端。',
    })
  }
  try {
    const title = (req.body?.title || '').trim()
    const subtitle = (req.body?.subtitle || '').trim()
    const themePath = (req.body?.themePath || '').trim()
    const templatePrompt = (req.body?.templatePrompt || '').trim()

    if (!templatePrompt) {
      return res.status(400).json({
        error: 'Bad request',
        hint: '需传递 templatePrompt（封面模版 prompt）。',
      })
    }
    if (!themePath) {
      return res.status(400).json({
        error: 'Bad request',
        hint: '需传递 themePath（封面主题路径）。',
      })
    }
    if (!title) {
      return res.status(400).json({
        error: 'Bad request',
        hint: '需填写封面标题。',
      })
    }

    const finalPrompt = buildScheme2DoubaoPrompt(themePath, title, subtitle, templatePrompt)
    const maxTokens = 768

    const useResponsesApi = DOUBAO_API_URL.includes('/responses')
    const requestBody = useResponsesApi
      ? {
          model: DOUBAO_MODEL,
          input: finalPrompt,
          stream: true,
        }
      : {
          model: DOUBAO_MODEL,
          messages: [
            {
              role: 'system',
              content: SYSTEM_SCHEME2_DOUBAO,
            },
            { role: 'user', content: finalPrompt },
          ],
          max_tokens: maxTokens,
          stream: true,
        }
    const resp = await axios.post(DOUBAO_API_URL, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DOUBAO_API_KEY}`,
      },
      timeout: 60000,
      responseType: 'stream',
      ...AXIOS_NO_ENV_PROXY,
    })

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders()
    }

    await streamDoubaoResponseToClient(resp, res)
    res.end()
  } catch (err) {
    console.error('[Doubao] request error', err?.response?.data || err)
    const detail = err?.response?.data ?? (err?.message ? String(err.message) : String(err))
    const hint = summarizeUpstreamErrorForHint(detail)
    const status =
      err?.response?.status >= 400 && err?.response?.status < 600 ? err.response.status : 500
    res.status(status).json({
      error: 'Doubao request failed',
      ...(hint ? { hint } : {}),
      detail,
    })
  }
})

app.post('/api/upload-image', upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) {
    return res.status(400).json({ error: 'no file uploaded' })
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return res.status(500).json({
      error: 'Blob not configured',
      hint:
        '请在 server/.env 中配置 BLOB_READ_WRITE_TOKEN（Vercel Blob，与线上 api/upload-image 一致）。',
    })
  }

  try {
    const key = buildBlobStorageKey('uploads', file.originalname, file.mimetype)
    const blob = await put(key, file.buffer, {
      access: 'public',
      addRandomSuffix: true,
    })
    res.json({ url: blob.url })
  } catch (err) {
    console.error('[upload-image] blob error', err)
    res.status(500).json({
      error: 'Upload failed',
      detail: err?.message || String(err),
    })
  }
})

/**
 * 人物参考图即梦预处理：使用当前封面模版相同的即梦模型/req_key，
 * 将原始参考图先规范为证件照风格，再交给后续封面生成。
 */
app.post('/api/jimeng-preprocess-reference', async (req, res) => {
  const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : ''
  const jimengModel = String(req.body?.jimengModel || 'image_4_0').trim()
  const prompt =
    (typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '') ||
    DEFAULT_JIMENG_REFERENCE_PREPROCESS_PROMPT

  if (!imageUrl) {
    return res.status(400).json({
      error: 'bad request',
      message: '缺少 imageUrl',
    })
  }
  if (!/^https?:\/\//i.test(imageUrl)) {
    return res.status(400).json({
      error: 'invalid imageUrl',
      message: '图片地址需为 http(s) 链接',
    })
  }
  if (!isAllowedJimengImageModel(jimengModel)) {
    return res.status(400).json({
      error: 'invalid jimengModel',
      hint: invalidJimengModelResponseHint(),
    })
  }

  const hasBearer = Boolean(JIMENG_API_KEY)
  const hasAKSK = Boolean(JIMENG_ACCESS_KEY_ID && JIMENG_SECRET_ACCESS_KEY && JIMENG_SERVICE)
  if (!hasBearer && !hasAKSK) {
    return res.status(500).json({
      error: 'No auth configured on server',
      hint: '请配置即梦鉴权。',
    })
  }

  const jimengReqKey = resolveJimengReqKey(jimengModel, process.env)
  if (!jimengReqKey) {
    return res.status(500).json({
      error: 'JIMENG_REQ_KEY is not configured',
      hint: missingJimengReqKeyHint(jimengModel),
    })
  }

  try {
    const { imageUrls, taskId } = await runJimengGenerate({
      prompt,
      n: 1,
      imageUrls: [imageUrl],
      reqKey: jimengReqKey,
      uploadsDir,
      jimengModel,
      omitPromptSuffix: true,
    })
    const firstImageUrl = Array.isArray(imageUrls) ? imageUrls[0] : ''
    const { optimizedImageUrl } = await materializeJimengPreprocessImageUrl({
      imageUrl: firstImageUrl,
      uploadsDir,
      req,
    })

    return res.json({ optimizedImageUrl, taskId })
  } catch (err) {
    console.error('[jimeng-preprocess-reference]', err?.response?.data || err)
    const detail = err?.response?.data || err?.message || String(err)
    return res.status(500).json({
      error: 'jimeng preprocess failed',
      message: typeof detail === 'string' ? detail : JSON.stringify(detail),
      detail,
    })
  }
})

/** 单次即梦 n=4，返回 4 张候选图 */
app.post('/api/scheme2-generate-cover', async (req, res) => {
  const hasBearer = Boolean(JIMENG_API_KEY)
  const hasAKSK = Boolean(JIMENG_ACCESS_KEY_ID && JIMENG_SECRET_ACCESS_KEY && JIMENG_SERVICE)
  if (!hasBearer && !hasAKSK) {
    return res.status(500).json({
      error: 'No auth configured on server',
      hint: '请配置即梦鉴权。',
    })
  }

  const jimengModel = String(req.body?.jimengModel || 'image_4_0').trim()
  if (!isAllowedJimengImageModel(jimengModel)) {
    return res.status(400).json({
      error: 'invalid jimengModel',
      hint: invalidJimengModelResponseHint(),
    })
  }
  const jimengReqKey = resolveJimengReqKey(jimengModel, process.env)
  if (!jimengReqKey) {
    return res.status(500).json({
      error: 'JIMENG_REQ_KEY is not configured',
      hint: missingJimengReqKeyHint(jimengModel),
    })
  }

  const prompt = (req.body?.prompt || '').trim()
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required', hint: '请填写画面内容（即梦 prompt）' })
  }

  const refImageUrls = normalizeScheme2ImageUrls(req.body)

  try {
    const { imageUrls: four, taskIds } = await runJimengGenerateBatchFour({
      prompt,
      reqKey: jimengReqKey,
      imageUrls: refImageUrls,
      uploadsDir,
      jimengModel,
      omitPromptSuffix: true,
    })
    if (four.length < 4 || four.some((u) => !u)) {
      return res.status(500).json({
        error: 'JiMeng returned fewer than 4 images',
        hint: '即梦单次任务未凑齐 4 张，请重试或检查即梦配置。',
        taskIds,
        count: four.filter(Boolean).length,
      })
    }

    return res.json({
      imageUrls: four,
      taskId: taskIds.join(','),
      taskIds,
    })
  } catch (err) {
    console.error('[scheme2-generate-cover]', err?.response?.data || err)
    res.status(500).json({
      error: 'scheme2 generate cover failed',
      detail: err?.response?.data || String(err),
    })
  }
})

/**
 * SSE:进程内排队后生成 1 张图，完成后立即推送 processImage。
 * POST body 与 /api/scheme2-generate-cover 相同。
 */
app.post('/api/scheme2-generate-cover-stream', async (req, res) => {
  const hasBearer = Boolean(JIMENG_API_KEY)
  const hasAKSK = Boolean(JIMENG_ACCESS_KEY_ID && JIMENG_SECRET_ACCESS_KEY && JIMENG_SERVICE)
  if (!hasBearer && !hasAKSK) {
    return res.status(500).json({
      error: 'No auth configured on server',
      hint: '请配置即梦鉴权。',
    })
  }

  const jimengModel = String(req.body?.jimengModel || 'image_4_0').trim()
  if (!isAllowedJimengImageModel(jimengModel)) {
    return res.status(400).json({
      error: 'invalid jimengModel',
      hint: invalidJimengModelResponseHint(),
    })
  }
  const jimengReqKey = resolveJimengReqKey(jimengModel, process.env)
  if (!jimengReqKey) {
    return res.status(500).json({
      error: 'JIMENG_REQ_KEY is not configured',
      hint: missingJimengReqKeyHint(jimengModel),
    })
  }

  const prompt = (req.body?.prompt || '').trim()
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required', hint: '请填写画面内容（即梦 prompt）' })
  }

  const refImageUrls = normalizeScheme2ImageUrls(req.body)
  const testMode = req.body?.testMode === true

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders()
  }

  try {
    let streamClosed = false
    const { job, position, promise } = enqueueJimengStreamJob(async () => {
      if (streamClosed || !canWriteSse(res)) return

      writeSse(res, 'start', { jimengModel, imageCount: 1, batch: false, serial: false, testMode })

      const { imageUrl, taskId, taskIds } = await runJimengGenerateSingle({
        prompt,
        reqKey: jimengReqKey,
        imageUrls: refImageUrls,
        uploadsDir,
        jimengModel,
        omitPromptSuffix: true,
        shouldContinue: () => !streamClosed && canWriteSse(res),
        onImage: ({ index, url, taskId }) => {
          if (!streamClosed && canWriteSse(res)) {
            writeSse(res, 'processImage', {
              url,
              index,
              taskId,
              id: `i${index}-${taskId}`,
            })
          }
        },
      })

      if (streamClosed || !canWriteSse(res)) return

      writeSse(res, 'jimengDone', { taskIds, count: 1, batch: false, serial: false })

      if (!imageUrl) {
        writeSse(res, 'error', {
          error: 'JiMeng returned no image',
          hint: '即梦未返回有效图片，请重试。',
          taskIds,
          count: 0,
        })
        res.end()
        return
      }

      writeSse(res, 'done', {
        imageUrl,
        imageUrls: [imageUrl],
        taskId,
        taskIds,
        ...(testMode ? { testMode: true } : {}),
      })
      res.end()
    })

    res.on('close', () => {
      if (!res.writableEnded) {
        streamClosed = true
        cancelQueuedJimengStreamJob(job)
      }
    })

    writeSse(res, 'queued', { position })
    drainJimengStreamQueue()
    await promise
  } catch (err) {
    console.error('[scheme2-generate-cover-stream]', err?.response?.data || err)
    const detail = err?.response?.data ?? String(err)
    const hint = summarizeUpstreamErrorForHint(detail)
    if (canWriteSse(res)) {
      writeSse(res, 'error', {
        error: 'scheme2 generate cover failed',
        ...(hint ? { hint } : {}),
        detail,
      })
      res.end()
    }
  }
})

app.listen(port, () => {
  console.log(`Poster backend listening on http://localhost:${port}`)
})
