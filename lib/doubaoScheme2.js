/**
 * 方案二:根据「封面主题路径 + 标题 + 副标题 + 封面模版 prompt」生成一条画面内容描述（供豆包 / 即梦使用）
 * 由 api/doubao.js 与 server/index.js 共用
 */

/**
 * @param {string} themePath 封面主题（一级 · 二级 · 三级）
 * @param {string} title 封面标题
 * @param {string} subtitle 封面副标题
 * @param {string} templatePrompt 当前选中封面模版的完整 prompt
 */
export function buildScheme2DoubaoPrompt(themePath, title, subtitle, templatePrompt) {
  const tp = (templatePrompt || '').trim()
  return `你是一名海报设计师，请改写基于「封面模版 prompt」改写。
  1）识别「封面模版 prompt」中「风格/排版/镜头/视角」的词语不要更改；
  2）非「风格/排版/镜头/视角」的词语，根据「封面主题」「标题」改写画面内容，不要更改「风格/排版/镜头/视角」词语的位置；
  3）将「封面模版prompt」中的标题等文案替换为提供的「标题」；
  4）输出要求:仅输出一条画面提示词，用于即梦文生图。


【封面主题】（一级 · 二级 · 三级）
${themePath || '（未提供）'}

【标题】
${title || '（未提供）'}

【副标题】
${subtitle || '（未提供）'}

【封面模版 prompt】（参考基座）
${tp || '（未提供）'}
`
}
