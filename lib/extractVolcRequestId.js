/**
 * 从火山 OpenAPI / 即梦 Visual 的 axios 响应中取出 request_id（便于本地排查与工单）。
 * 成功体常见 ResponseMetadata.RequestId；错误体常见顶层 request_id。
 *
 * @param {{ data?: unknown, headers?: Record<string, string> } | null | undefined} resp axios 响应
 * @returns {string | undefined}
 */
export function extractVolcRequestId(resp) {
  if (!resp) return undefined
  const headers = resp.headers || {}
  const fromHeader = headers['x-request-id'] || headers['X-Request-Id']
  if (fromHeader) return String(fromHeader)

  const data = resp.data
  if (!data || typeof data !== 'object') return undefined

  const err = data.error
  if (err && typeof err === 'object') {
    const eid = err.request_id ?? err.RequestId
    if (eid != null && String(eid).trim()) return String(eid)
  }

  return (
    data.ResponseMetadata?.RequestId ||
    data.response_metadata?.request_id ||
    data.request_id ||
    data.RequestId ||
    undefined
  )
}
