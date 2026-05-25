/**
 * POST /api/jimeng-preprocess-reference（Vercel）
 * 使用与当前封面模板相同的即梦模型，对人物参考图做预处理。
 */
import axios from 'axios'
import crypto from 'crypto'
import { AXIOS_NO_ENV_PROXY } from '../lib/axiosNoEnvProxy.js'
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
import { extractVolcRequestId } from '../lib/extractVolcRequestId.js'
import {
  DEFAULT_JIMENG_REFERENCE_PREPROCESS_PROMPT,
  materializeJimengPreprocessImageUrl,
} from '../lib/jimengReferencePreprocess.js'

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
}

const JIMENG_ACCESS_KEY_ID = process.env.JIMENG_ACCESS_KEY_ID
const JIMENG_SECRET_ACCESS_KEY = process.env.JIMENG_SECRET_ACCESS_KEY
const JIMENG_REGION = process.env.JIMENG_REGION || 'cn-beijing'
const JIMENG_SERVICE = process.env.JIMENG_SERVICE || 'cv'
const JIMENG_API_KEY = process.env.JIMENG_API_KEY
const VISUAL_HOST = process.env.VISUAL_HOST || 'visual.volcengineapi.com'
const VISUAL_BASE_URL = `https://${VISUAL_HOST}`
const JIMENG_REQ_KEY = process.env.JIMENG_REQ_KEY

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

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
  n = 1,
  imageUrls: refImageUrls,
  reqKey: reqKeyOpt,
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
  const count = Math.min(4, Math.max(1, Number(n) || 1))
  const takeUrls = (urls) => (Array.isArray(urls) && urls.length > 0 ? urls.slice(0, count) : urls)
  const submitBody = await buildJimengSyncAsyncSubmitBody({
    reqKey,
    finalPrompt,
    n: count,
    refImageUrls,
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

  console.log('[JiMeng preprocess] CVSync2AsyncSubmitTask', {
    task_id: taskId || null,
    request_id: extractVolcRequestId(submitResp) || null,
    jimengModel,
    req_key: reqKey,
  })

  if (!taskId) {
    throw new Error('No task_id returned from CVSync2AsyncSubmitTask')
  }

  const getUrl = `${VISUAL_BASE_URL}/?Action=CVSync2AsyncGetResult&Version=2022-08-31`
  for (let i = 0; i < JIMENG_POLL_MAX_ITERATIONS; i++) {
    const getResp = await volcPost({
      url: getUrl,
      payload: JSON.stringify({
        req_key: reqKey,
        task_id: taskId,
      }),
      useAKSK,
    })

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

  throw new Error('JiMeng task timeout')
}

export default async function handler(req, res) {
  corsHeaders(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : ''
  const jimengModel = String(req.body?.jimengModel || 'image_4_0').trim()
  const prompt =
    (typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '') ||
    DEFAULT_JIMENG_REFERENCE_PREPROCESS_PROMPT

  if (!imageUrl) {
    return res.status(400).json({ error: 'bad request', message: '缺少 imageUrl' })
  }
  if (!/^https?:\/\//i.test(imageUrl)) {
    return res.status(400).json({ error: 'invalid imageUrl', message: '图片地址需为 http(s) 链接' })
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
      jimengModel,
      omitPromptSuffix: true,
    })
    const firstImageUrl = Array.isArray(imageUrls) ? imageUrls[0] : ''
    const { optimizedImageUrl } = await materializeJimengPreprocessImageUrl({
      imageUrl: firstImageUrl,
      uploadsDir: undefined,
      req: undefined,
    })

    return res.status(200).json({ optimizedImageUrl, taskId })
  } catch (err) {
    console.error('[jimeng-preprocess-reference]', err?.response?.data || err)
    const detail = err?.response?.data || err?.message || String(err)
    return res.status(500).json({
      error: 'jimeng preprocess failed',
      message: typeof detail === 'string' ? detail : JSON.stringify(detail),
      detail,
    })
  }
}
