/**
 * 读取 fetch 返回的 text/event-stream，按事件回调。
 * 约定每条消息为 event: name + 单行 data: JSON
 */
export async function readSseStream(
  response: Response,
  onEvent: (eventName: string, data: unknown) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\n\n+/)
    buffer = parts.pop() || ''
    for (const block of parts) {
      dispatchSseBlock(block, onEvent)
    }
  }
  if (buffer.trim()) {
    dispatchSseBlock(buffer, onEvent)
  }
}

function dispatchSseBlock(block: string, onEvent: (eventName: string, data: unknown) => void) {
  const lines = block.split('\n').filter(Boolean)
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  const raw = dataLines.join('\n')
  if (!raw) return
  try {
    onEvent(eventName, JSON.parse(raw))
  } catch {
    onEvent(eventName, raw)
  }
}
