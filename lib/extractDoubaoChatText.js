/**
 * 火山方舟 Chat Completions 的 message.content 可能是 string，
 * 或多模态数组 [{ type: 'text', text: '...' }, ...]。
 */
export function extractDoubaoChatText(respData) {
  const raw = respData?.choices?.[0]?.message?.content
  if (raw == null) return ''
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw)) {
    return raw
      .map((part) => {
        if (typeof part === 'string') return part
        if (part?.text != null) return String(part.text)
        if (typeof part?.content === 'string') return part.content
        return ''
      })
      .join('')
      .trim()
  }
  return String(raw).trim()
}
