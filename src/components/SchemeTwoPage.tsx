import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { CoverThemeSelection } from '../data/coverTemplates'
import {
  COVER_TEMPLATES,
  getTemplatesForTheme,
  templateUsesReferencePreprocess,
} from '../data/coverTemplates'
import { readSseStream } from '../utils/readSseStream'
import { assertDoubaoJsonResponse } from '../utils/parseDoubaoApiResponse'
import { getApiBase, resolvePreviewImageUrl, uploadImageAndGetUrl } from '../utils/uploadImage'
import { useToast } from './Toast/ToastProvider'
import { CoverThemeField } from './scheme2/CoverThemeField'
import './scheme2/schemeTwo.css'

const API_BASE = getApiBase()

function StopIcon() {
  return (
    <svg aria-hidden="true" className="btnIcon" viewBox="0 0 16 16" focusable="false">
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  )
}

/** 将生成图绘制为 1080×1440 PNG（cover 填满画幅） */
async function exportGeneratedImageTo1080x1440(imageUrl: string): Promise<void> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      el.crossOrigin = 'anonymous'
    }
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('图片加载失败'))
    el.src = imageUrl
  })

  const w = 1080
  const h = 1440
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('无法创建画布')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)

  const iw = img.naturalWidth
  const ih = img.naturalHeight
  const scale = Math.max(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = (w - dw) / 2
  const dy = (h - dh) / 2
  ctx.drawImage(img, dx, dy, dw, dh)

  const dataUrl = canvas.toDataURL('image/png')
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = 'poster-1080x1440.png'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/** 封面主题 + 模版 + 豆包文案 + 即梦生图 */
export function SchemeTwoPage() {
  const { showApiError } = useToast()
  const [themeSelection, setThemeSelection] = useState<CoverThemeSelection | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [schemeTwoTitle, setSchemeTwoTitle] = useState('')
  const [schemeTwoSubtitle] = useState('')
  const [schemeTwoPrompt, setSchemeTwoPrompt] = useState('')
  /** 画面内容输入框仅在「随机生成文案」成功后展示 */
  const [promptFieldVisible, setPromptFieldVisible] = useState(false)
  const [randomLoading, setRandomLoading] = useState(false)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  /** 生成流程阶段；非 idle 时按钮切换为停止生成 */
  const [coverGenPhase, setCoverGenPhase] = useState<'idle' | 'preprocess' | 'queued' | 'stream'>('idle')
  const [scheme2ReferenceImageUrl, setScheme2ReferenceImageUrl] = useState('')
  const scheme2FileInputRef = useRef<HTMLInputElement | null>(null)
  const generateAbortRef = useRef<AbortController | null>(null)
  const generateStopReasonRef = useRef<'user' | 'timeout' | null>(null)

  const matchedTemplates = useMemo(() => getTemplatesForTheme(themeSelection), [themeSelection])

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateId) return null
    return COVER_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? null
  }, [selectedTemplateId])

  const randomReady =
    !!themeSelection && schemeTwoTitle.trim().length > 0 && !!selectedTemplate

  const needsReferenceImage = !!selectedTemplate?.requiresReferenceImage
  const generateImageReady =
    randomReady &&
    schemeTwoPrompt.trim().length > 0 &&
    (!needsReferenceImage || scheme2ReferenceImageUrl.trim().length > 0)

  function resetCoverSelection() {
    setCoverPreviewUrl(null)
  }

  useEffect(() => {
    setSelectedTemplateId(null)
    setSchemeTwoPrompt('')
    setPromptFieldVisible(false)
    setScheme2ReferenceImageUrl('')
    resetCoverSelection()
  }, [themeSelection])

  async function handleRandomGenerate() {
    if (!randomReady || !themeSelection || !selectedTemplate) return
    setRandomLoading(true)
    try {
      const themePath = `${themeSelection.level1} · ${themeSelection.level2} · ${themeSelection.level3}`
      const res = await fetch(`${API_BASE}/api/doubao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          themePath,
          title: schemeTwoTitle.trim(),
          subtitle: schemeTwoSubtitle.trim() || '',
          templatePrompt: selectedTemplate.prompt,
        }),
      })
      if (!res.ok) {
        const nonJsonHint = assertDoubaoJsonResponse(res)
        if (nonJsonHint) {
          showApiError({ title: '随机生成文案失败', data: { hint: nonJsonHint }, httpStatus: res.status })
          return
        }
        const data = await res.json().catch(() => ({}))
        showApiError({ title: '随机生成文案失败', data, httpStatus: res.status })
        return
      }
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('text/event-stream')) {
        showApiError({
          title: '随机生成文案失败',
          data: { hint: '接口未返回流式响应，请确认后端 /api/doubao 已更新并重启。' },
          httpStatus: res.status,
        })
        return
      }

      let text = ''
      let finished = false
      let streamErr: Error | null = null
      setSchemeTwoPrompt('')
      setPromptFieldVisible(true)
      await readSseStream(res, (event, data) => {
        if (event === 'delta' && data && typeof data === 'object' && data !== null) {
          const delta = (data as { text?: unknown }).text
          if (typeof delta === 'string' && delta) {
            text += delta
            setSchemeTwoPrompt((prev) => prev + delta)
          }
        }
        if (event === 'done' && data && typeof data === 'object' && data !== null) {
          finished = true
          const finalText = (data as { text?: unknown }).text
          if (typeof finalText === 'string' && finalText) {
            text = finalText
            setSchemeTwoPrompt(finalText)
          }
        }
        if (event === 'error' || event === 'failed') {
          const d = data as { hint?: string; error?: string; detail?: unknown; message?: string }
          showApiError({ title: '随机生成文案失败', data: d })
          streamErr = new Error('stream_error')
        }
      })
      if (streamErr) {
        throw streamErr
      }
      if (!text || typeof text !== 'string') {
        showApiError({
          title: '随机生成文案失败',
          data: { error: 'Doubao returned empty', hint: '豆包响应中未解析到文案' },
          httpStatus: res.status,
        })
        return
      }
      if (!finished) {
        showApiError({
          title: '随机生成文案失败',
          data: { hint: '流式响应未正常结束，请重试' },
          httpStatus: res.status,
        })
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError' && e.message !== 'stream_error') {
        showApiError({
          title: '随机生成文案失败',
          data: { message: e.message },
        })
      }
    } finally {
      setRandomLoading(false)
    }
  }

  const handleScheme2ReferenceUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const url = await uploadImageAndGetUrl(file)
      setScheme2ReferenceImageUrl(url)
    } catch (err) {
      showApiError({
        title: '上传参考图失败',
        data: { message: err instanceof Error ? err.message : String(err) },
      })
    }
    e.target.value = ''
  }

  async function handleGenerateCover() {
    if (!generateImageReady || !selectedTemplate) return
    const prompt = schemeTwoPrompt.trim()
    if (!prompt) return

    generateAbortRef.current?.abort()
    const ac = new AbortController()
    generateAbortRef.current = ac
    generateStopReasonRef.current = null

    resetCoverSelection()

    const streamTimeoutMs = 300_000
    const streamTimeoutId = window.setTimeout(() => {
      generateStopReasonRef.current = 'timeout'
      ac.abort()
    }, streamTimeoutMs)

    const refTrim = scheme2ReferenceImageUrl.trim()
    let refForJimeng = refTrim
    let anyImageReceived = false

    try {
      setCoverGenPhase(
        templateUsesReferencePreprocess(selectedTemplate) &&
          selectedTemplate.requiresReferenceImage &&
          refTrim
          ? 'preprocess'
          : 'stream',
      )
      if (
        templateUsesReferencePreprocess(selectedTemplate) &&
        selectedTemplate.requiresReferenceImage &&
        refTrim
      ) {
        const gpRes = await fetch(`${API_BASE}/api/jimeng-preprocess-reference`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateId: selectedTemplate.id,
            imageUrl: refTrim,
            jimengModel: selectedTemplate.jimengModel,
          }),
          signal: ac.signal,
        })
        const gpData = (await gpRes.json().catch(() => ({}))) as {
          optimizedImageUrl?: string
          message?: string
          detail?: string
          hint?: string
          error?: string
        }
        if (!gpRes.ok) {
          showApiError({ title: '参考图预处理失败', data: gpData, httpStatus: gpRes.status })
          return
        }
        const opt = gpData.optimizedImageUrl
        if (!opt || typeof opt !== 'string') {
          showApiError({
            title: '参考图预处理失败',
            data: { hint: '预处理未返回图片地址' },
            httpStatus: gpRes.status,
          })
          return
        }
        refForJimeng = opt
      }

      setCoverGenPhase('stream')
      const imageUrls =
        selectedTemplate.requiresReferenceImage && refForJimeng ? [refForJimeng] : undefined

      const res = await fetch(`${API_BASE}/api/scheme2-generate-cover-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          prompt,
          jimengModel: selectedTemplate.jimengModel,
          ...(imageUrls ? { imageUrls } : {}),
        }),
        signal: ac.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showApiError({ title: '生成封面失败', data, httpStatus: res.status })
        return
      }
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('text/event-stream')) {
        throw new Error('未收到流式响应（Content-Type 异常）')
      }

      let finished = false
      let streamErr: Error | null = null
      await readSseStream(res, (event, data) => {
        if (event === 'queued') {
          setCoverGenPhase('queued')
        }
        if (event === 'start') {
          setCoverGenPhase('stream')
        }
        if (event === 'processImage' && data && typeof data === 'object' && data !== null) {
          const d = data as {
            url?: string
            index?: number
          }
          if (d.url && typeof d.url === 'string') {
            anyImageReceived = true
            setCoverPreviewUrl(d.url)
          }
        }
        if (event === 'done') {
          finished = true
        }
        if (event === 'failed' || event === 'error') {
          const d = data as { hint?: string; error?: string; detail?: unknown; message?: string }
          showApiError({ title: '生成封面失败', data: d })
          streamErr = new Error('stream_error')
        }
      })

      if (streamErr) {
        throw streamErr
      }
      if (!finished) {
        showApiError({
          title: '生成封面失败',
          data: { hint: '流式响应未正常结束，请重试' },
        })
        return
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        if (generateStopReasonRef.current === 'user') {
          return
        }
        if (anyImageReceived) {
          showApiError({
            title: '生成封面超时',
            data: { hint: '图片已生成并展示，可继续使用或重新生成。' },
          })
        }
        return
      }
      if (!(e instanceof Error && e.message === 'stream_error')) {
        showApiError({
          title: '生成封面失败',
          data: { message: e instanceof Error ? e.message : String(e) },
        })
      }
    } finally {
      window.clearTimeout(streamTimeoutId)
      setCoverGenPhase('idle')
      generateAbortRef.current = null
      generateStopReasonRef.current = null
    }
  }

  function handleStopGenerate() {
    generateStopReasonRef.current = 'user'
    generateAbortRef.current?.abort()
    setCoverGenPhase('idle')
  }

  function handleGenerateButtonClick() {
    if (coverGenPhase !== 'idle') {
      handleStopGenerate()
      return
    }
    void handleGenerateCover()
  }

  const handleExport = async () => {
    if (!coverPreviewUrl) return
    try {
      await exportGeneratedImageTo1080x1440(coverPreviewUrl)
    } catch (error) {
      console.error('导出海报失败', error)
      alert('导出海报失败，请稍后重试。')
    }
  }

  return (
    <div className="schemeTwo">
      <div className="schemeTwo__design">
        <section className="schemeTwo__card">
          <h2 className="schemeTwo__cardTitle">封面内容</h2>
          <div className="schemeTwo__row3">
            <CoverThemeField value={themeSelection} onChange={setThemeSelection} />
            <div className="titleRow__field">
              <span className="titleRow__label">2、输入封面标题（必填）</span>
              <input
                className="titleRow__input"
                type="text"
                placeholder="必填，不超过10个字"
                value={schemeTwoTitle}
                onChange={(e) => setSchemeTwoTitle(e.target.value)}
                maxLength={10}
              />
            </div>
          </div>
        </section>

        <section className="schemeTwo__card">
          <h2 className="schemeTwo__cardTitle">设计封面</h2>

          <div className="schemeTwo__stack">
            <div className="schemeTwo__stackSection">
              <span className="titleRow__label">1、选择封面模版</span>
              {!themeSelection ? (
                <p className="schemeTwo__templateHint">请先选择封面主题</p>
              ) : matchedTemplates.length === 0 ? (
                <p className="schemeTwo__templateHint">暂无与该主题关联的封面模版</p>
              ) : (
                <div className="schemeTwo__templateRow">
                  {matchedTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className={`schemeTwo__template${selectedTemplateId === tpl.id ? ' schemeTwo__template--active' : ''}`}
                      onClick={() => {
                        setSelectedTemplateId(tpl.id)
                        setSchemeTwoPrompt('')
                        setPromptFieldVisible(false)
                        setScheme2ReferenceImageUrl('')
                        resetCoverSelection()
                      }}
                      title={tpl.name}
                      aria-label={`封面模版 ${tpl.name}`}
                    >
                      <img src={tpl.imageUrl} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedTemplate?.requiresReferenceImage ? (
              <div className="schemeTwo__stackSection">
                <span className="titleRow__label">老师参考图</span>
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    marginTop: 8,
                  }}
                >
                  <div className="uploadArea" style={{ flexShrink: 0 }}>
                    <input
                      ref={scheme2FileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleScheme2ReferenceUpload}
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                      aria-label="上传老师参考图"
                    />
                    {scheme2ReferenceImageUrl ? (
                      <div className="uploadArea__preview">
                        <img
                          src={resolvePreviewImageUrl(scheme2ReferenceImageUrl)}
                          alt="老师参考图预览"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-fontgy-4)' }}>点击上传</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <input
                      className="titleRow__input"
                      type="text"
                      placeholder="或粘贴图片 URL"
                      value={scheme2ReferenceImageUrl}
                      onChange={(e) => setScheme2ReferenceImageUrl(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div className="schemeTwo__stackSection">
              <div className="schemeTwo__actionRow">
                <span className="titleRow__label schemeTwo__actionRowLabel">2、设计画面内容</span>
                <button
                  type="button"
                  className="btnSecondary"
                  disabled={!randomReady || randomLoading}
                  onClick={handleRandomGenerate}
                >
                  {randomLoading ? '生成中…' : '随机生成文案'}
                </button>
                <button
                  type="button"
                  className="btnPrimary"
                  disabled={coverGenPhase === 'idle' && !generateImageReady}
                  onClick={handleGenerateButtonClick}
                >
                  {coverGenPhase === 'preprocess'
                    ? (
                        <>
                          <StopIcon />
                          正在优化参考图…
                        </>
                      )
                    : coverGenPhase === 'queued'
                      ? (
                          <>
                            <StopIcon />
                            排队中…
                          </>
                        )
                    : coverGenPhase === 'stream'
                      ? (
                          <>
                            <StopIcon />
                            生成中…
                          </>
                        )
                      : '生成图片'}
                </button>
              </div>
              {promptFieldVisible && (
                <textarea
                  className="promptInput schemeTwo__promptInput"
                  placeholder="输入文案"
                  value={schemeTwoPrompt}
                  onChange={(e) => setSchemeTwoPrompt(e.target.value)}
                />
              )}
            </div>
          </div>
        </section>
      </div>

      <aside className="schemeTwo__previewCol">
        <div className="schemeTwo__previewCard">
          <div className="schemeTwo__previewHeader">
            <h2 className="schemeTwo__previewTitle">封面预览</h2>
            <button
              type="button"
              className="previewExportBtn"
              onClick={handleExport}
              disabled={!coverPreviewUrl}
            >
              导出封面
            </button>
          </div>
          {coverPreviewUrl ? (
            <div className="schemeTwo__previewRaw">
              <img
                src={resolvePreviewImageUrl(coverPreviewUrl)}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <div className="schemeTwo__previewMock" aria-hidden />
          )}
        </div>
      </aside>
    </div>
  )
}
