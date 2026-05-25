/** 从接口 JSON 错误体解析出的展示字段 */
export type ApiErrorDisplay = {
  httpStatus?: number
  code?: string
  type?: string
  meaning?: string
  /** 后端 hint 或拼接后的补充说明 */
  hint?: string
}

const CODE_MEANINGS: Record<string, string> = {
  AccountOverdueError: '火山方舟账号欠费或余额不足，请充值后重试',
  AccessDenied: '访问被拒绝，请检查 API Key 与产品权限',
  InvalidApiKey: 'API Key 无效或已失效',
  AuthenticationError: '鉴权失败，请检查 API Key',
  RateLimitExceeded: '请求频率超限，请稍后重试',
  '50400': '访问被拒绝（鉴权或权限不足）',
  '50430': '即梦接口并发已达上限，请稍后重试',
  '50207': '参考图数据格式不符合即梦要求',
  '50500': '即梦服务内部错误，请稍后重试',
  '50501': '即梦算法服务内部错误，请稍后重试',
}

function meaningForCode(code: string | undefined): string | undefined {
  if (!code) return undefined
  const trimmed = code.trim()
  return CODE_MEANINGS[trimmed] ?? CODE_MEANINGS[String(Number(trimmed))] ?? undefined
}

function pickString(v: unknown): string | undefined {
  if (v == null) return undefined
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v)
  return undefined
}

function extractFromDetail(detail: unknown): Partial<ApiErrorDisplay> {
  if (detail == null) return {}
  if (typeof detail === 'string') {
    return { hint: detail.trim() || undefined }
  }
  if (typeof detail !== 'object') return {}

  const d = detail as Record<string, unknown>
  const nested = d.error
  if (nested && typeof nested === 'object') {
    const e = nested as Record<string, unknown>
    const code = pickString(e.code) ?? pickString(d.code)
    const type = pickString(e.type) ?? pickString(d.type)
    const message = pickString(e.message) ?? pickString(d.message)
    return {
      code,
      type,
      meaning: meaningForCode(code) ?? message,
      hint: message,
    }
  }

  const code = pickString(d.code) ?? pickString(d.status)
  const message = pickString(d.message)
  return {
    code,
    type: pickString(d.type),
    meaning: meaningForCode(code) ?? message,
    hint: message,
  }
}

/**
 * 解析后端 / 上游返回的错误 JSON，提取错误码、类型与可读含义。
 */
export function parseApiErrorResponse(data: unknown, httpStatus?: number): ApiErrorDisplay {
  const out: ApiErrorDisplay = { httpStatus }

  if (!data || typeof data !== 'object') {
    if (httpStatus) {
      out.meaning = httpStatus >= 500 ? '服务端错误' : '请求未通过'
    }
    return out
  }

  const d = data as Record<string, unknown>
  out.hint = pickString(d.hint)

  const fromDetail = extractFromDetail(d.detail)
  Object.assign(out, fromDetail)

  const topCode = pickString(d.code) ?? pickString(d.status)
  if (!out.code && topCode) out.code = topCode

  const nestedErr = d.error
  if (!out.code && nestedErr && typeof nestedErr === 'object') {
    const e = nestedErr as Record<string, unknown>
    out.code = pickString(e.code)
    out.type = out.type ?? pickString(e.type)
    const msg = pickString(e.message)
    out.hint = out.hint ?? msg
    out.meaning = out.meaning ?? meaningForCode(out.code) ?? msg
  }

  if (typeof d.error === 'string' && d.error.trim() && !out.hint) {
    out.hint = d.error.trim()
  }

  if (!out.meaning) {
    out.meaning =
      meaningForCode(out.code) ??
      out.hint ??
      (typeof d.message === 'string' ? d.message : undefined)
  }

  if (!out.type && httpStatus === 403) out.type = 'Forbidden'
  if (!out.type && httpStatus === 401) out.type = 'Unauthorized'

  return out
}
