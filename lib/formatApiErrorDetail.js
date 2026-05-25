/**
 * 将上游（方舟豆包、即梦等）错误体压成简短可读字符串，供 JSON 的 `hint` 字段展示。
 * @param {unknown} detail
 * @param {{ maxLen?: number }} [opts]
 * @returns {string}
 */
export function summarizeUpstreamErrorForHint(detail, opts = {}) {
  const maxLen = typeof opts.maxLen === 'number' && opts.maxLen > 0 ? opts.maxLen : 900
  if (detail == null) return ''
  if (typeof detail === 'string') return trimLong(detail.trim(), maxLen)
  if (typeof detail === 'number' || typeof detail === 'boolean') return String(detail)
  if (typeof detail === 'object') {
    const d = /** @type {Record<string, unknown>} */ (detail)
    const err = d.error
    if (err && typeof err === 'object') {
      const e = /** @type {Record<string, unknown>} */ (err)
      const code = e.code != null ? String(e.code) : ''
      const msg = e.message != null ? String(e.message) : ''
      if (code || msg) return trimLong([code, msg].filter(Boolean).join(' — '), maxLen)
    }
    if (typeof d.message === 'string' && d.message.trim()) return trimLong(d.message.trim(), maxLen)
    try {
      return trimLong(JSON.stringify(detail), maxLen)
    } catch {
      return '上游返回了无法序列化的错误对象'
    }
  }
  return trimLong(String(detail), maxLen)
}

/**
 * @param {unknown} value
 * @param {number} maxLen
 */
function trimLong(value, maxLen) {
  const s = String(value)
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}
