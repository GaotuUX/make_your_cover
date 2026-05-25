/** 方案一：豆包「随机生成文案」模板（【主题】【标题】【副标题】由后端替换） */
export const PROMPT_FOR_DOUBAO =
  '你是一名海报设计师。请根据海报类型【主题】，海报标题是【标题】，海报副标题是【副标题】，设计 1句符合格式的短句:[人物]在[画面/环境]里[表情动作/场景]。作为海报画面内容。'

/** 方案一：即梦生图时在用户文案后拼接的固定后缀 */
export const JIMENG_PROMPT_SUFFIX =
  '卡通化，迪士尼，柔和的 3D 动画渲染,参考人物一致性,截取其胸部以上的位置,构图饱满,人物头部处于画面2/3以下,请生成4张不同的图'

/** 方案一 POST /api/jimeng 的完整 prompt（后缀在前端拼接，后端不再读环境变量） */
export function buildJimengSchemeOnePrompt(userPrompt: string): string {
  const trimmed = userPrompt.trim()
  if (!trimmed) return JIMENG_PROMPT_SUFFIX
  return `${trimmed} ${JIMENG_PROMPT_SUFFIX}`
}
