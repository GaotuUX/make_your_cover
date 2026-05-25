import axios from 'axios'
import { AXIOS_NO_ENV_PROXY } from '../lib/axiosNoEnvProxy.js'
import { buildScheme2DoubaoPrompt } from '../lib/doubaoScheme2.js'
import { extractDoubaoResponseText } from '../lib/extractDoubaoResponseText.js'
import { logDoubaoUsage } from '../lib/logDoubaoUsage.js'
import { summarizeUpstreamErrorForHint } from '../lib/formatApiErrorDetail.js'
import { DEFAULT_PROMPT_FOR_DOUBAO } from '../lib/promptDefaults.js'

const DOUBAO_API_KEY = (process.env.DOUBAO_API_KEY || '').trim()
const DOUBAO_API_URL =
  (process.env.DOUBAO_API_URL || '').trim() ||
  'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const DOUBAO_MODEL =
  (process.env.DOUBAO_MODEL || '').trim() || 'doubao-seed-1-6-flash-250828'

const SYSTEM_SCHEME2 =
  '你是图生图提示词专家。用户消息中已给出「封面主题」「标题」「副标题」与「封面模版 prompt」四部分；你必须综合这四项生成**一条**中文画面描述正文，不要复述字段名，不要前言、分点、markdown。'

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

  if (!DOUBAO_API_KEY) {
    return res.status(500).json({
      error: 'Doubao not configured',
      hint: '请在 Vercel 环境变量中配置 DOUBAO_API_KEY。',
    })
  }

  try {
    const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : ''
    const isScheme2 = mode === 'scheme2'
    const title = (req.body?.title || '').trim()
    const subtitle = (req.body?.subtitle || '').trim()
    const theme = (req.body?.theme || '').trim()
    const userPrompt = req.body?.userPrompt || ''

    let finalPrompt
    let maxTokens = 256

    if (isScheme2) {
      const themePath = (req.body?.themePath || '').trim()
      const templatePrompt = (req.body?.templatePrompt || '').trim()
      if (!templatePrompt) {
        return res.status(400).json({
          error: 'Bad request',
          hint: '方案二需传递 templatePrompt（封面模版 prompt）。',
        })
      }
      if (!themePath) {
        return res.status(400).json({
          error: 'Bad request',
          hint: '方案二需传递 themePath（封面主题路径）。',
        })
      }
      if (!title) {
        return res.status(400).json({
          error: 'Bad request',
          hint: '方案二需填写封面标题。',
        })
      }
      finalPrompt = buildScheme2DoubaoPrompt(themePath, title, subtitle, templatePrompt)
      maxTokens = 768
    } else {
      const rawTemplate = req.body?.systemPrompt || DEFAULT_PROMPT_FOR_DOUBAO
      const filledTemplate = rawTemplate
        .replace(/【主题】/g, theme || '主题')
        .replace(/【标题】/g, title || '标题')
        .replace(/【副标题】/g, subtitle || '副标题')

      finalPrompt = userPrompt
        ? `${filledTemplate}\n\n补充说明:${userPrompt}`
        : filledTemplate
    }

    const useResponsesApi = DOUBAO_API_URL.includes('/responses')
    const requestBody = useResponsesApi
      ? { model: DOUBAO_MODEL, input: finalPrompt }
      : {
          model: DOUBAO_MODEL,
          messages: [
            {
              role: 'system',
              content: isScheme2
                ? SYSTEM_SCHEME2
                : '你是一名海报设计师，擅长根据标题、副标题和主题，设计符合指定格式的画面描述。',
            },
            { role: 'user', content: finalPrompt },
          ],
          max_tokens: maxTokens,
        }

    const resp = await axios.post(DOUBAO_API_URL, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DOUBAO_API_KEY}`,
      },
      timeout: 60000,
      ...AXIOS_NO_ENV_PROXY,
    })
    logDoubaoUsage('api/doubao', resp.data)

    const text = extractDoubaoResponseText(resp.data)
    if (!text) {
      return res.status(500).json({
        error: 'Doubao returned empty',
        hint: '豆包响应中未解析到文本，请检查 DOUBAO_API_URL 与 DOUBAO_MODEL 是否匹配（建议 chat/completions + 接入点模型 ID）。',
        detail: resp.data,
      })
    }
    res.json({ text })
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
