import axios from 'axios'
import { AXIOS_NO_ENV_PROXY } from '../lib/axiosNoEnvProxy.js'
import { buildScheme2DoubaoPrompt } from '../lib/doubaoScheme2.js'
import { summarizeUpstreamErrorForHint } from '../lib/formatApiErrorDetail.js'

const DOUBAO_API_KEY = (process.env.DOUBAO_API_KEY || '').trim()
const DOUBAO_API_URL =
  (process.env.DOUBAO_API_URL || '').trim() ||
  'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const DOUBAO_MODEL =
  (process.env.DOUBAO_MODEL || '').trim() || 'doubao-seed-1-6-flash-250828'

const SYSTEM_PROMPT =
  '你是图生图提示词专家。用户消息中已给出「封面主题」「标题」「副标题」与「封面模版 prompt」四部分；你必须综合这四项生成**一条**中文画面描述正文，不要复述字段名，不要前言、分点、markdown。'

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function writeSse(res, eventName, payload) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
  res.write(`event: ${eventName}\n`)
  res.write(`data: ${data}\n\n`)
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

export default async function handler(req, res) {
  corsHeaders(res)
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!DOUBAO_API_KEY) {
    return res.status(500).json({
      error: 'Doubao not configured',
      hint: '请在 Vercel 环境变量中配置 DOUBAO_API_KEY。',
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
      ? { model: DOUBAO_MODEL, input: finalPrompt, stream: true }
      : {
          model: DOUBAO_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
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
}
