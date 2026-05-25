/**
 * 将 Google / 网络错误转为方案二可读的「message」（不含密钥）。
 * @param {unknown} detail
 * @returns {string}
 */
export function userMessageForGooglePreprocessError(detail) {
  const s = typeof detail === 'string' ? detail : JSON.stringify(detail ?? '')
  if (
    /User location is not supported|location is not supported|not supported for the API use/i.test(
      s,
    )
  ) {
    return '当前网络区域无法使用 Google Gemini 预处理（官方 API 地区限制）。请更换可访问该 API 的网络/部署区域，或暂时选择不走「参考图预处理」的模版。'
  }
  return '参考图预处理失败，请重试或更换图片。'
}
