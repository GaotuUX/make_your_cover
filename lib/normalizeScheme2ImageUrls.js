/**
 * 从方案二生成请求 body 中解析参考图 URL（与 /api/jimeng 一致）。
 * @param {unknown} body
 * @returns {string[] | undefined}
 */
export function normalizeScheme2ImageUrls(body) {
  const raw = body?.imageUrls
  if (!Array.isArray(raw)) return undefined
  const urls = raw
    .filter((u) => typeof u === 'string' && u.trim())
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u))
  return urls.length > 0 ? urls : undefined
}
