import JSZip from 'jszip'
import type { CoverTemplate, CoverThemeSelection } from '../data/coverTemplates'
import { templateUsesReferencePreprocess } from '../data/coverTemplates'
import { assertDoubaoJsonResponse } from './parseDoubaoApiResponse'
import { getApiBase, resolvePreviewImageUrl, uploadImageAndGetUrl } from './uploadImage'
import { readSseStream } from './readSseStream'

const API_BASE = getApiBase()

type GenerateBatchCoverOptions = {
  title: string
  theme: CoverThemeSelection
  template: CoverTemplate
  teacherFile?: File | null
  signal?: AbortSignal
  onPhase?: (phase: 'prompt' | 'image') => void
}

export async function generateBatchCover({
  title,
  theme,
  template,
  teacherFile,
  signal,
  onPhase,
}: GenerateBatchCoverOptions): Promise<string> {
  onPhase?.('prompt')
  const prompt = await generatePrompt({ title, theme, template, signal })
  let refUrl = ''

  if (template.requiresReferenceImage) {
    if (!teacherFile) {
      throw new Error('该模板需要老师图')
    }
    refUrl = await uploadImageAndGetUrl(teacherFile)
  }

  onPhase?.('image')
  if (refUrl && templateUsesReferencePreprocess(template)) {
    refUrl = await preprocessReferenceImage({
      templateId: template.id,
      imageUrl: refUrl,
      jimengModel: template.jimengModel,
      signal,
    })
  }

  return generateImage({
    prompt,
    template,
    imageUrls: template.requiresReferenceImage && refUrl ? [refUrl] : undefined,
    signal,
  })
}

export async function exportBatchImagesAsZip(
  rows: { title: string; resultImg?: string | null }[],
  filename = 'batch-covers.zip',
) {
  const zip = new JSZip()
  let count = 0
  for (const [index, row] of rows.entries()) {
    if (!row.resultImg) continue
    const url = resolvePreviewImageUrl(row.resultImg)
    const res = await fetch(url)
    if (!res.ok) continue
    const blob = await res.blob()
    const ext = detectImageExt(blob.type)
    const safeTitle = sanitizeFilename(row.title || `cover-${index + 1}`)
    zip.file(`${String(index + 1).padStart(2, '0')}-${safeTitle}.${ext}`, blob)
    count += 1
  }
  if (count === 0) {
    throw new Error('暂无可导出的生成结果')
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(zipBlob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

async function generatePrompt({
  title,
  theme,
  template,
  signal,
}: {
  title: string
  theme: CoverThemeSelection
  template: CoverTemplate
  signal?: AbortSignal
}): Promise<string> {
  const res = await fetch(`${API_BASE}/api/doubao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      themePath: `${theme.level1} · ${theme.level2} · ${theme.level3}`,
      title,
      subtitle: '',
      templatePrompt: template.prompt,
    }),
    signal,
  })
  if (!res.ok) {
    const nonJsonHint = assertDoubaoJsonResponse(res)
    if (nonJsonHint) throw new Error(nonJsonHint)
    const data = await res.json().catch(() => ({}))
    throw new Error(extractApiError(data) || '随机生成文案失败')
  }
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    throw new Error('豆包接口未返回流式响应')
  }

  let text = ''
  let finished = false
  await readSseStream(res, (event, data) => {
    if (event === 'delta' && data && typeof data === 'object') {
      const delta = (data as { text?: unknown }).text
      if (typeof delta === 'string') text += delta
    }
    if (event === 'done' && data && typeof data === 'object') {
      finished = true
      const finalText = (data as { text?: unknown }).text
      if (typeof finalText === 'string' && finalText) text = finalText
    }
    if (event === 'error' || event === 'failed') {
      throw new Error(extractApiError(data) || '随机生成文案失败')
    }
  })
  if (!finished || !text.trim()) {
    throw new Error('随机生成文案未正常完成')
  }
  return text.trim()
}

async function preprocessReferenceImage({
  templateId,
  imageUrl,
  jimengModel,
  signal,
}: {
  templateId: string
  imageUrl: string
  jimengModel: CoverTemplate['jimengModel']
  signal?: AbortSignal
}): Promise<string> {
  const res = await fetch(`${API_BASE}/api/jimeng-preprocess-reference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, imageUrl, jimengModel }),
    signal,
  })
  const data = (await res.json().catch(() => ({}))) as { optimizedImageUrl?: string }
  if (!res.ok || !data.optimizedImageUrl) {
    throw new Error(extractApiError(data) || '参考图预处理失败')
  }
  return data.optimizedImageUrl
}

async function generateImage({
  prompt,
  template,
  imageUrls,
  signal,
}: {
  prompt: string
  template: CoverTemplate
  imageUrls?: string[]
  signal?: AbortSignal
}): Promise<string> {
  const res = await fetch(`${API_BASE}/api/scheme2-generate-cover-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      prompt,
      jimengModel: template.jimengModel,
      ...(imageUrls ? { imageUrls } : {}),
    }),
    signal,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(extractApiError(data) || '生成封面失败')
  }
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    throw new Error('即梦接口未返回流式响应')
  }

  let imageUrl = ''
  let finished = false
  await readSseStream(res, (event, data) => {
    if (event === 'processImage' && data && typeof data === 'object') {
      const url = (data as { url?: unknown }).url
      if (typeof url === 'string' && url) {
        imageUrl = url
      }
    }
    if (event === 'done') {
      finished = true
    }
    if (event === 'error' || event === 'failed') {
      throw new Error(extractApiError(data) || '生成封面失败')
    }
  })
  if (!finished || !imageUrl) {
    throw new Error('生成封面未正常完成')
  }
  return imageUrl
}

function extractApiError(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  return String(record.hint || record.message || record.error || record.detail || '')
}

function detectImageExt(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  return 'png'
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'cover'
}
