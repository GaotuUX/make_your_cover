/**
 * 按封面模版 jimengModel 解析即梦 req_key（与火山文档一致，见 server/CONFIG.md）
 * @param {string} [jimengModel]
 * @param {Record<string, string | undefined>} env 通常为 process.env
 * @returns {string}
 */
export function resolveJimengReqKey(jimengModel, env) {
  const m = String(jimengModel || 'image_4_0').trim()
  if (m === 'image_3_0') {
    return (env.JIMENG_REQ_KEY_T2I_V30 || '').trim() || 'jimeng_t2i_v30'
  }
  if (m === 'image_4_6') {
    return (env.JIMENG_REQ_KEY_IMAGE_46 || '').trim() || 'jimeng_seedream46_cvtob'
  }
  return (env.JIMENG_REQ_KEY || '').trim()
}

/** @param {string} [jimengModel] */
export function jimengModelAllowedValues() {
  return ['image_4_0', 'image_4_6', 'image_3_0']
}

/** @param {string} [jimengModel] */
export function isAllowedJimengImageModel(jimengModel) {
  return jimengModelAllowedValues().includes(String(jimengModel || '').trim())
}

/** @param {string} [jimengModel] */
export function invalidJimengModelResponseHint() {
  return '请使用 image_4_0（即梦图片生成 4.0）、image_4_6（即梦图片生成 4.6）或 image_3_0（即梦文生图 3.0）'
}

/** @param {string} [jimengModel] */
export function missingJimengReqKeyHint(jimengModel) {
  const m = String(jimengModel || 'image_4_0').trim()
  if (m === 'image_3_0') {
    return '请配置 JIMENG_REQ_KEY_T2I_V30（文生图 3.0 req_key，默认 jimeng_t2i_v30）'
  }
  if (m === 'image_4_6') {
    return '请配置 JIMENG_REQ_KEY_IMAGE_46（图片生成 4.6 req_key，默认 jimeng_seedream46_cvtob，见火山文档）'
  }
  return '请配置 JIMENG_REQ_KEY（图片生成 4.0 req_key）'
}
