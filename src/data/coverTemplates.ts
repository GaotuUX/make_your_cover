/** 封面模版与主题绑定；图片可为外链或 public 下静态资源 */

import referencePreprocessPrompts from './coverTemplateGooglePreprocess.json'

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')

export type CoverThemeSelection = {
  level1: string
  level2: string
  level3: string
}

export type ThemeBinding = {
  l1: string
  l2?: string | null
  l3?: string | null
}

/** 与即梦能力 req_key 对应:4.0 / 4.6 / 文生图 3.0 共用 AK/SK，见 server/CONFIG.md */
export type JimengImageModel = 'image_4_0' | 'image_4_6' | 'image_3_0'

export type CoverTemplate = {
  id: string
  name: string
  imageUrl: string
  prompt: string
  /** 决定方案二「生成图片」调用即梦哪一版接口（4.0 / 4.6 / 文生图 3.0） */
  jimengModel: JimengImageModel
  /** 为 true 时方案二需上传/填写老师参考图，生成时随 prompt 传给即梦 image_urls */
  requiresReferenceImage?: boolean
  themeBindings: ThemeBinding[]
}

/** 该模版是否在生成前对参考图做预处理（文案见 coverTemplateGooglePreprocess.json） */
export function templateUsesReferencePreprocess(tpl: CoverTemplate): boolean {
  return typeof referencePreprocessPrompts[tpl.id as keyof typeof referencePreprocessPrompts] === 'string'
}

export function bindingMatches(sel: CoverThemeSelection, b: ThemeBinding): boolean {
  if (b.l1 !== sel.level1) return false
  if (b.l2 != null && b.l2 !== sel.level2) return false
  if (b.l3 != null && b.l3 !== sel.level3) return false
  return true
}

export function templateMatchesTheme(tpl: CoverTemplate, sel: CoverThemeSelection): boolean {
  return tpl.themeBindings.some((b) => bindingMatches(sel, b))
}

export function getTemplatesForTheme(sel: CoverThemeSelection | null): CoverTemplate[] {
  if (!sel) return []
  return COVER_TEMPLATES.filter((t) => templateMatchesTheme(t, sel))
}

export const COVER_TEMPLATES: CoverTemplate[] = [
  {
    id: 'tpl-knowledge-whale-ocean-traveler',
    name: '鲸鱼·远洋行者',
    imageUrl: `${BASE}cover-templates/tpl-knowledge-whale-ocean-traveler.png`,
    jimengModel: 'image_4_6',
    prompt:
      '3D 皮克斯 Q 版卡通，低幼向，可爱鲸鱼圆脸大眼，在海洋中自在游动，海底光线柔和，珊瑚海草丰富整齐，画面清新治愈，无复杂细节，生物动作缓慢呆萌，色调温暖明亮，主题文案「鲸鱼：远洋里的行者」，采用潮流派对风格艺术字体，字体笔画粗厚醒目，部分笔画带俏皮弧度或独特弯折，营造活泼、肆意、充满活力的氛围。标题位于画面顶部约 1/3 区域，环绕主体；配色：深色字体（环境色）加白色描边，在浅色背景上非常突出；排版：占据画面上方约三分之一，环绕主体。',
    themeBindings: [{ l1: '知识拓展' }],
  },
  {
    id: 'tpl-subject-math-trig-identities',
    name: '三角函数公式课堂',
    imageUrl: `${BASE}cover-templates/tpl-subject-math-trig-identities.png`,
    jimengModel: 'image_4_0',
    requiresReferenceImage: true,
    prompt:
      '卡通化，迪士尼，柔和的 3D 动画渲染，色彩饱和度高，突出视觉吸引力。主题文案白色字体「三角函数公式」，采用潮流派对风格艺术字体，模拟真手写笔触，字体笔画粗厚醒目，形态夸张变形，部分笔画带俏皮弧度或独特弯折，营造活泼、肆意、充满活力的氛围；搭配副标题「三角恒等变换」进行排版；标题在画面上方三分之一位置，标题构图饱满；明亮整洁的高中教室，阳光从窗户洒入，参考图片的老师站在黑板前，特写镜头，手持粉笔认真讲解数学知识，黑板上写满工整清晰的三角函数公式、三角恒等变换推导过程，整体画面清新治愈。',
    themeBindings: [{ l1: '学科知识', l2: '学科同步' }],
  },
  {
    id: 'tpl-minimal-flat-aesthetic',
    name: '极简扁平美学',
    imageUrl: `${BASE}cover-templates/tpl-minimal-flat-aesthetic.png`,
    jimengModel: 'image_4_6',
    prompt:
      '扁平运动感插画风格海报，扁平手绘，杂色，噪点颗粒，夸张造型和明快色彩突出视觉表现力，将真实元素卡通化、几何化提炼。卡通交警形象，采用夸张圆润的几何造型，脸部轮廓圆润，眼睛大而有神，佩戴白色交警帽（帽带为蓝色），通过简洁线条和色块塑造认真坚定表情，皮肤光滑，光影过渡简洁保留 “平面化” 特征。利落短发，身穿蓝色交警制服（衣摆有白色反光条）、黑色执勤鞋，手腕戴简约黑色手环，手部和腿部比例夸张粗壮。右臂向前伸展处于指挥交通的动态姿势，动作富有动感，视觉镜头远近拉伸效果。画面一半为浅灰色路面，背景添加白色大小不一的交通标识简笔画作为点缀，上面左边中文 “交通安全与出行规范专题”，下面左边小字 “Traffic Safety”，',
    themeBindings: [{ l1: '成长经验' }],
  },
  {
    id: 'tpl-vibrant-pop-collage',
    name: '元气拼贴主义',
    imageUrl: `${BASE}cover-templates/tpl-vibrant-pop-collage.png`,
    jimengModel: 'image_4_6',
    prompt:
      '大学新生入学全攻略专题海报，风格为波普拼贴，大标题为：大学新生入学全攻略专题！副标题为：Freshman Guide！风格为剪纸、拼贴、波普。校园教学楼，两位新生，书包，校园小径，图书馆旁，写实场景整体风格为拼贴风海报设计，画面元素丰富，多处使用手绘风格箭头、涂鸦符号、白色描边和波浪线，增添动感与创意气息，氛围积极、青春、富有生活感。',
    themeBindings: [{ l1: '校园生活' }],
  },
  {
    id: 'tpl-teacher-exclusive-a',
    name: '老师专属a',
    imageUrl: `${BASE}cover-templates/tpl-teacher-exclusive-a.png`,
    jimengModel: 'image_4_6',
    prompt:
      '核心主体：（实验教师），身着（白色实验服、蓝色内搭衬衣，利落短发），手持（激光笔与玻璃砖），(神情专注严谨)；细节描述：(佩戴护目镜，简约实验手套，实验桌刻度标识清晰)，背景（明亮物理实验室，桌面摆放光学实验器材、光路图纸，折射光线在暗室中清晰显现）文字：主题文案白色字体 "（物理光的折射）"，（采用科技感几何艺术字体，笔画硬朗利落，线条棱角分明，带有光线折射质感，营造科学、理性、直观的氛围。）标题在画面顶部，3D皮克斯和儿童读物插图的风格技术参数：8K 高清，3:4，细节拉满，抗锯齿；景深，(俯视鱼眼) 镜头，(从下往上) 拍摄，(强烈的仰视) 透视感，负面排除：模糊、畸形、杂乱背景、颗粒感、过度曝光。',
    themeBindings: [{ l1: '学科知识', l2: '学科同步' }],
  },
  {
    id: 'tpl-teacher-exclusive-b',
    name: '老师专属b',
    imageUrl: `${BASE}cover-templates/tpl-teacher-exclusive-b.png`,
    jimengModel: 'image_4_6',
    prompt:
      '核心主体：（实验教师），身着（白色实验服、蓝色内搭衬衣，利落短发），手持（激光笔与玻璃砖），(神情专注严谨)；细节描述：(佩戴护目镜，简约实验手套，实验桌刻度标识清晰)，背景（明亮物理实验室，桌面摆放光学实验器材、光路图纸，折射光线在暗室中清晰显现）文字：主题文案白色字体 "（物理光的折射）"，（采用科技感几何艺术字体，笔画硬朗利落，线条棱角分明，带有光线折射质感，营造科学、理性、直观的氛围。）标题在画面顶部。风格化玩法，把这张照片改成照片与手绘插画结合的创意混搭风格图像。用简洁黑色勾线和平涂色彩重绘出 Q 版化的卡通人物，手绘部分采用具有轻微笔触感的粗线条，并非完全平滑的矢量线。技术参数：8K 高清，3:4，细节拉满，抗锯齿；景深，(从下往上) 拍摄，(强烈的仰视) 透视感，负面排除：模糊、畸形、杂乱背景、颗粒感、过度曝光。',
    themeBindings: [{ l1: '学科知识', l2: '考试专题' }],
  },
  {
    id: 'tpl-teacher-exclusive-c',
    name: '老师专属c',
    imageUrl: `${BASE}cover-templates/tpl-teacher-exclusive-c.png`,
    jimengModel: 'image_4_6',
    prompt:
      '图片风格化，羊毛毡，哑光质感，皮克斯和儿童读物插图的风格，核心主体：（实验教师），身着（白色实验服、蓝色内搭衬衣，利落短发），手持（激光笔与玻璃砖），(神情专注严谨)；细节描述：(佩戴护目镜，简约实验手套，实验桌刻度标识清晰)，背景（明亮物理实验室，桌面摆放光学实验器材、光路图纸，折射光线在暗室中清晰显现）文字：主题文案白色字体 "（物理光的折射）"，（采用科技感几何艺术字体，笔画硬朗利落，线条棱角分明，带有光线折射质感，营造科学、理性、直观的氛围。）标题在画面顶部。(从下往上) 拍摄，(强烈的仰视) 透视感，负面排除：模糊、畸形、杂乱背景、颗粒感、过度曝光。',
    themeBindings: [{ l1: '学科知识', l2: '学科拓展' }],
  },
  {
    id: 'tpl-virtual-mixed-cartoon',
    name: '虚拟混合（卡通）',
    imageUrl: `${BASE}cover-templates/tpl-virtual-mixed-cartoon.png`,
    jimengModel: 'image_4_6',
    prompt:
      '3D 卡通拟物风格，高饱和度明亮色彩，科技感强烈。主题文案 "2026 天津市艺术类招生" 使用白色未来科技字体，字体线条粗壮，带有蓝色光晕和数字元素，局部笔画弯折夸张，突出智能与创新。搭配绿色曲线和艺术画板。辅助文案 "艺考新征程，梦想正启航"。主角为帅气男生，绿色衣服，广角仰视，手拿画板，动作夸张。背景为地标建筑微缩模型，蓝天白云和动感树叶点缀。',
    themeBindings: [{ l1: '教育动态' }],
  },
  {
    id: 'tpl-virtual-mixed-real-person',
    name: '虚拟混合(真人）',
    imageUrl: `${BASE}cover-templates/tpl-virtual-mixed-real-person.png`,
    jimengModel: 'image_4_6',
    requiresReferenceImage: true,
    prompt:
      '高清图像识别，精准提取人物主体与场景细节，智能优化人像画质，磨皮自然不失真，提亮肤色均匀通透，修复面部瑕疵与模糊噪点，增强五官立体感，发丝清晰分明，优化光影层次与对比度，提升整体分辨率至 8K，画面质感细腻高级，人物比例协调自然，背景干净整洁，整体风格真实耐看，无过度修图痕迹。3D 卡通拟物风格，高饱和度明亮色彩，科技感强烈。主题文案 "深圳国际双语研讨会" 使用白色未来科技字体，字体线条粗壮，带有蓝色光晕和数字元素，局部笔画弯折夸张，突出智能与创新。搭配绿色曲线和双语展示牌。辅助文案 "中外融智，语通未来"。广角仰视，手拿双语手册，动作夸张。背景为深圳地标建筑微缩模型，蓝天白云和动感树叶点缀。',
    themeBindings: [{ l1: '教育动态' }],
  },
]
