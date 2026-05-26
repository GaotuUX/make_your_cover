/**
 * POST /api/scheme2-generate-cover-stream（SSE）
 * 即梦生成 4 张图后结束，不再调用豆包多模态选图。
 */
import axios from 'axios'
import crypto from 'crypto'
import path from 'path'
import { AXIOS_NO_ENV_PROXY } from '../lib/axiosNoEnvProxy.js'
import { extractVolcRequestId } from '../lib/extractVolcRequestId.js'
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

const JIMENG_ACCESS_KEY_ID = process.env.JIMENG_ACCESS_KEY_ID
const JIMENG_SECRET_ACCESS_KEY = process.env.JIMENG_SECRET_ACCESS_KEY
const JIMENG_REGION = process.env.JIMENG_REGION || 'cn-beijing'
const JIMENG_SERVICE = process.env.JIMENG_SERVICE || 'cv'
const JIMENG_API_KEY = process.env.JIMENG_API_KEY

const VISUAL_HOST = process.env.VISUAL_HOST || 'visual.volcengineapi.com'
const VISUAL_BASE_URL = `https://${VISUAL_HOST}`
const JIMENG_REQ_KEY = process.env.JIMENG_REQ_KEY
const JIMENG_REQ_KEY_T2I_V30 =
  (process.env.JIMENG_REQ_KEY_T2I_V30 || '').trim() || 'jimeng_t2i_v30'

/** 本地开发若走 Vercel Serverless 但参考图落在本机 uploads，可设 JIMENG_LOCAL_UPLOADS_DIR=server/uploads */
function jimengLocalUploadsDir() {
  const p = (process.env.JIMENG_LOCAL_UPLOADS_DIR || '').trim()
  if (!p) return undefined
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p)
}
const JIMENG_UPLOADS_DIR_FOR_RESOLVE = jimengLocalUploadsDir()

function sha256Hex(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function hmac(key, content, encoding) {
  return crypto.createHmac('sha256', key).update(content).digest(encoding)
}

function toAmzDate(date) {
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
 * In-process FIFO only. This serializes JiMeng generation inside one Node/Vercel
 * instance; it is not a distributed lock across multiple serverless instances.
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

      if (singleUrl) imageUrls = [singleUrl]
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
        uploadsDir: JIMENG_UPLOADS_DIR_FOR_RESOLVE,
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
}
