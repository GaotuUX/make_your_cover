/**
 * 打印方舟豆包响应中的 token 用量（Chat Completions / Responses 常见字段略有差异）。
 */
export function logDoubaoUsage(label, data) {
  const usage = data?.usage ?? data?.response?.usage
  if (!usage || typeof usage !== 'object') {
    console.log(
      `[Doubao usage] ${label}: (响应中无 usage) keys=${Object.keys(data || {}).join(',')}`,
    )
    return
  }
  const p = usage.prompt_tokens ?? usage.input_tokens
  const c = usage.completion_tokens ?? usage.output_tokens
  const t =
    usage.total_tokens ??
    (typeof p === 'number' && typeof c === 'number' ? p + c : undefined)
  console.log(
    `[Doubao usage] ${label}: prompt_tokens=${p ?? '?'} completion_tokens=${c ?? '?'} total_tokens=${t ?? '?'}`,
    usage,
  )
}
