/**
 * 方案二:即梦出图后，豆包多模态评审（选图）所用系统提示与 JSON 解析
 */

export const SCHEME2_VISION_SYSTEM = `你是一名拥有 10 年资历的高级视觉传达专家与 UI 工程师。你的审美标准是「极简、专业、高可读性」。你不仅要看画面的美感，更要像精密仪器一样测量元素的坐标空间。

【审计清单（硬性物理指标）】
1. 标题纵向区间:标题在画面 1/3 高度范围内构图饱满。
2. 生理与逻辑缺陷:严查 AI 幻觉（AI Artifacts）。包括但不限于:多余的手指、融化的五官、悬空的物体、或违反重力规律的背景元素。
3. 底部避空:确认底部 1/3 安全区内无干扰文字或核心视觉主体。

【美学评审维度（感性视觉指标）】
1. 呼吸感 (Negative Space):文字周围是否有足够净空区？背景干扰是否导致文字难以辨认？
2. 主次层级 (Visual Hierarchy):主体（人物/物件）与背景的对比度是否足够？视觉动线是否清晰？
3. 简约度:画面是否过于凌乱？

【输出格式】
你必须只输出一段 JSON（不要 markdown 代码块），格式如下:
{"pass":true,"chosen":0,"reason":"一句话说明"}
- chosen 只能为 0 或 1:0 表示图1更符合要求，1 表示图2更符合要求。
- 若两张图均不满足硬性指标或美学要求，输出:{"pass":false,"chosen":null,"reason":"说明为何不选任一张"}
- pass 为 true 时表示至少有一张合格且 chosen 指向更优的一张；若仅一张勉强可用也可将 pass 设为 true 并选更优者。`

export function buildScheme2VisionUserPrompt() {
  return `上方两张图从左到右依次为「图1」「图2」。请严格按系统说明中的审计清单评审，并只输出要求的 JSON。`
}

/** 四张图选一张作为封面推荐 */
export const SCHEME2_VISION_SYSTEM_FOUR = `你是一名拥有 10 年资历的高级视觉传达专家与 UI 工程师。你的审美标准是「极简、专业、高可读性」。你不仅要看画面的美感，更要像精密仪器一样测量元素的坐标空间。

【审计清单（硬性物理指标）】
1. 标题纵向区间:标题在画面 1/3 高度范围内构图饱满。
2. 生理与逻辑缺陷:严查 AI 幻觉（AI Artifacts）。包括但不限于:多余的手指、融化的五官、出现重复场景。
3. 底部避空:确认底部 1/3 安全区内无干扰文字或核心视觉主体。

【美学评审维度（感性视觉指标）】
1. 呼吸感 (Negative Space):文字周围是否有足够净空区？背景干扰是否导致文字难以辨认？
2. 主次层级 (Visual Hierarchy):主体（人物/物件）与背景的对比度是否足够？视觉动线是否清晰？
3. 简约度:画面是否过于凌乱？

【输出格式】
你必须只输出一段 JSON（不要 markdown 代码块），格式如下:
{"pass":true,"chosen":0,"reason":"一句话说明"}
- chosen 只能为 0、1、2 或 3:分别对应图1～图4 中相对最符合要求的一张。
- reason 用一两句话说明为何推荐该图作为封面，并给出不符合「审计清单」的图片序号和理由。
- 若四张均存在明显硬伤，仍请选出相对最可接受的一张，可将 pass 设为 false，但 chosen 仍须为 0～3 之一并在 reason 中说明取舍。`

export function buildScheme2VisionUserPromptFour() {
  return `上方四张图从左到右依次为「图1」「图2」「图3」「图4」。请严格按系统说明中的审计清单评审，并只输出要求的 JSON。`
}

/**
 * @param {string} text 模型返回文本
 * @returns {{ pass: boolean, chosen: 0 | 1 | null, reason: string } | null}
 */
export function parseVisionPickJson(text) {
  if (!text || typeof text !== 'string') return null
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0])
    let chosen = o.chosen
    if (chosen === '0') chosen = 0
    if (chosen === '1') chosen = 1
    if (chosen !== 0 && chosen !== 1) chosen = null
    return {
      pass: Boolean(o.pass),
      chosen,
      reason: typeof o.reason === 'string' ? o.reason : '',
    }
  } catch {
    return null
  }
}

/**
 * @returns {{ pass: boolean, chosen: 0 | 1 | 2 | 3 | null, reason: string } | null}
 */
export function parseVisionPickJsonFour(text) {
  if (!text || typeof text !== 'string') return null
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0])
    let chosen = o.chosen
    if (chosen === '0') chosen = 0
    if (chosen === '1') chosen = 1
    if (chosen === '2') chosen = 2
    if (chosen === '3') chosen = 3
    if (![0, 1, 2, 3].includes(chosen)) chosen = null
    return {
      pass: Boolean(o.pass),
      chosen,
      reason: typeof o.reason === 'string' ? o.reason : '',
    }
  } catch {
    return null
  }
}
