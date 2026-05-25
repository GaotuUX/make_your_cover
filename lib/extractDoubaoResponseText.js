import { extractDoubaoChatText } from './extractDoubaoChatText.js'

function collectTextFromContent(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part?.type === 'output_text' && part.text != null) return String(part.text)
        if (part?.text != null) return String(part.text)
        if (typeof part?.content === 'string') return part.content
        if (Array.isArray(part?.content)) return collectTextFromContent(part.content)
        return ''
      })
      .join('')
      .trim()
  }
  return String(content).trim()
}

function extractFromOutputItem(item) {
  if (!item || typeof item !== 'object') return ''
  const direct = collectTextFromContent(item.text ?? item.content)
  if (direct) return direct
  if (Array.isArray(item.output)) {
    for (const nested of item.output) {
      const t = extractFromOutputItem(nested)
      if (t) return t
    }
  }
  return ''
}

/**
 * 从火山方舟 Responses API 或 Chat Completions 响应中提取 assistant 文本。
 * @param {unknown} respData
 * @returns {string}
 */
export function extractDoubaoResponseText(respData) {
  if (respData == null) return ''
  if (typeof respData === 'string') return respData.trim()

  const chat = extractDoubaoChatText(respData)
  if (chat) return chat

  if (typeof respData === 'object') {
    const d = /** @type {Record<string, unknown>} */ (respData)
    if (typeof d.output_text === 'string' && d.output_text.trim()) {
      return d.output_text.trim()
    }
    const out = d.output
    if (Array.isArray(out)) {
      for (const item of out) {
        const t = extractFromOutputItem(item)
        if (t) return t
      }
    }
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      const t = extractFromOutputItem(out)
      if (t) return t
    }
  }

  return ''
}
