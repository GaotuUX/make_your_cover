import {
  applyResolvedRefToSubmitBody,
  resolveJimengReferenceImagesAsync,
} from './resolveJimengReferenceForSubmit.js'

/** 即梦 4.6 文档：prompt 长度上限约 800 字 */
const JIMENG_46_PROMPT_MAX = 800

/**
 * 4.6 与 4.0 共用 CVSync2AsyncSubmitTask；宽高成对传入，固定 3:4（1080×1440，与封面/4.0 一致）。
 * scale 50：即梦 4.6 文档为整型档位（与 4.0 浮点 0.5 不同）。
 * @see https://www.volcengine.com/docs/85621/2275082?lang=zh
 */
const JIMENG_46_WIDTH = 1080
const JIMENG_46_HEIGHT = 1440
const JIMENG_46_SCALE = 50

function augmentPromptForJimeng46Multi(count, text) {
  let p = (text || '').trim()
  if (count <= 1) return p
  if (/4[\s]*张|四张|四幅|组图|一次.*[1-4]\s*张|输出.*[1-4]\s*张/i.test(p)) {
    return p
  }
  return `${p} 请一次性输出${count}张。`
}

/**
 * 组装 CVSync2AsyncSubmitTask 的 JSON body。
 * 4.6 文档未列出 `n` 等 4.0 专用字段，原样传入可能导致服务端 50500 Internal Error。
 * 参考图在服务端解析（含公网 URL 拉取转 base64），见 `resolveJimengReferenceImagesAsync`。
 *
 * @param {{
 *   reqKey: string,
 *   finalPrompt: string,
 *   n?: number,
 *   refImageUrls?: string[],
 *   uploadsDir?: string,
 *   jimengModel?: string,
 * }} opts
 */
export async function buildJimengSyncAsyncSubmitBody({
  reqKey,
  finalPrompt,
  n = 4,
  refImageUrls,
  uploadsDir,
  jimengModel,
}) {
  const count = Math.min(4, Math.max(1, Number(n) || 4))
  const resolvedRef = await resolveJimengReferenceImagesAsync(refImageUrls, { uploadsDir })

  if (jimengModel === 'image_4_6') {
    let prompt = augmentPromptForJimeng46Multi(count, finalPrompt)
    if (prompt.length > JIMENG_46_PROMPT_MAX) {
      prompt = prompt.slice(0, JIMENG_46_PROMPT_MAX)
    }
    const submitBody = {
      req_key: reqKey,
      prompt,
      scale: JIMENG_46_SCALE,
      width: JIMENG_46_WIDTH,
      height: JIMENG_46_HEIGHT,
    }
    applyResolvedRefToSubmitBody(submitBody, resolvedRef, { jimengModel: 'image_4_6' })
    return submitBody
  }

  const submitBody = {
    req_key: reqKey,
    prompt: finalPrompt,
    scale: 0.5,
    width: 1080,
    height: 1440,
    n: count,
  }
  applyResolvedRefToSubmitBody(submitBody, resolvedRef)
  return submitBody
}
