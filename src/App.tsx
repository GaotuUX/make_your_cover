import { useEffect, useRef, useState } from 'react'
import { PosterPreview } from './components/PosterPreview'
import { ImagePromptInput } from './components/controls/ImagePromptInput'
import { SchemeSwitch } from './components/SchemeSwitch'
import { SchemeTwoPage } from './components/SchemeTwoPage'
import * as htmlToImage from 'html-to-image'
import {
  buildJimengSchemeOnePrompt,
  PROMPT_FOR_DOUBAO,
} from './config/promptDefaults'
import { assertDoubaoJsonResponse } from './utils/parseDoubaoApiResponse'
import { getApiBase, resolvePreviewImageUrl, uploadImageAndGetUrl } from './utils/uploadImage'
import { showApiErrorToast } from './components/Toast/ToastProvider'

const DEFAULT_IMAGE_URL =
  'https://i.gsxcdn.com/3603876693_8mg8hmgm.png'

/** 后端 API 地址，部署时设置 VITE_API_URL 指向独立部署的后端 */
const API_BASE = getApiBase()

async function generateImageWithJiMeng(
  prompt: string,
  imageUrl?: string | null,
): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/jimeng`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: buildJimengSchemeOnePrompt(prompt),
      imageUrls: imageUrl ? [imageUrl] : undefined,
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    showApiErrorToast({ title: '即梦生成失败', data: errBody, httpStatus: res.status })
    throw new Error('api_error')
  }
  const data = await res.json()

  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
    return data.imageUrls as string[]
  }
  if (typeof data.imageUrl === 'string' && data.imageUrl) {
    return [data.imageUrl as string]
  }

  throw new Error('JiMeng response has no image URLs')
}

/** 方案二:将生成图绘制为 1080×1440 PNG（cover 填满画幅） */
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

export default function App() {
  const [schemeTwo, setSchemeTwo] = useState(false)
  const [schemeTwoPreviewUrl, setSchemeTwoPreviewUrl] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [theme, setTheme] = useState('')
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGE_URL)
  const [referenceImageUrl, setReferenceImageUrl] = useState<string>('')
  const [backgroundImages, setBackgroundImages] = useState<string[]>([])
  const [selectedBackgroundIndex, setSelectedBackgroundIndex] = useState<number>(-1)
  const posterRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!schemeTwo) {
      setSchemeTwoPreviewUrl(null)
    }
  }, [schemeTwo])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const url = await uploadImageAndGetUrl(file)
      setReferenceImageUrl(url)
    } catch (err) {
      if (!(err instanceof Error && err.message === 'api_error')) {
        showApiErrorToast({
          title: '上传参考图失败',
          data: { message: err instanceof Error ? err.message : String(err) },
        })
      }
    }
    e.target.value = ''
  }

  const handleExport = async () => {
    if (schemeTwo) {
      if (!schemeTwoPreviewUrl) return
      try {
        await exportGeneratedImageTo1080x1440(schemeTwoPreviewUrl)
      } catch (error) {
        console.error('导出海报失败', error)
        alert('导出海报失败，请稍后重试。')
      }
      return
    }

    const node = posterRef.current
    if (!node) return

    try {
      const scale = 1080 / 360
      const dataUrl = await htmlToImage.toPng(node, {
        width: 1080,
        height: 1440,
        style: {
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: '360px',
          height: '480px',
        },
      })

      const link = document.createElement('a')
      link.href = dataUrl
      link.download = 'poster-1080x1440.png'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('导出海报失败', error)
      alert('导出海报失败，请稍后重试。')
    }
  }

  const exportDisabled = schemeTwo ? !schemeTwoPreviewUrl : false

  return (
    <div className="demoPage">
      {/* 顶部导航栏 */}
      <header className="navBar">
        <div className="navBar__leading">
          <SchemeSwitch schemeTwo={schemeTwo} onChange={setSchemeTwo} />
        </div>
        <h1 className="navBar__title">封面设计</h1>
        <button
          type="button"
          className="navBar__export"
          onClick={handleExport}
          disabled={exportDisabled}
        >
          导出封面
        </button>
      </header>

      {schemeTwo ? (
        <SchemeTwoPage onCoverPreviewUrlChange={setSchemeTwoPreviewUrl} />
      ) : (
      <div className="demoPage__main">
        {/* 左侧:设计输入 */}
        <div className="demoPage__design">
          {/* 1. 设计封面标题 */}
          <section className="card">
            <h2 className="card__title">设计封面标题</h2>
            <div className="titleRow">
              <div className="titleRow__field">
                <span className="titleRow__label">1、输入画面标题（必填）</span>
                <input
                  className="titleRow__input"
                  type="text"
                  placeholder="必填，不超过10个字"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={10}
                />
              </div>
              <div className="titleRow__field">
                <span className="titleRow__label">2、输入封面副标题（选填）</span>
                <input
                  className="titleRow__input"
                  type="text"
                  placeholder="选填，不超过10个字"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  maxLength={10}
                />
              </div>
            </div>
          </section>

          {/* 2. 设计封面背景 */}
          <section className="card">
            <h2 className="card__title">设计封面背景</h2>

            <div className="backgroundSection" style={{ marginBottom: 24 }}>
              <span className="backgroundSection__label">1、输入主题</span>
              <input
                className="titleRow__input"
                type="text"
                placeholder="如:职场精英、图书馆学习"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              />
            </div>

            <div className="backgroundSection" style={{ marginBottom: 24 }}>
              <span className="backgroundSection__label">2、老师参考图</span>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div className="uploadArea" style={{ flexShrink: 0 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleUpload}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                    aria-label="上传老师参考图"
                  />
                  {referenceImageUrl ? (
                    <div className="uploadArea__preview">
                      <img
                        src={resolvePreviewImageUrl(referenceImageUrl)}
                        alt="参考图预览"
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
                    value={referenceImageUrl}
                    onChange={(e) => setReferenceImageUrl(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="backgroundSection" style={{ marginBottom: 24 }}>
              <ImagePromptInput
                disabled={!title.trim()}
                randomDisabled={!theme.trim() || !title.trim()}
                onRandomGenerate={async () => {
                  const themeText = theme.trim()
                  const userPrompt = themeText
                    ? `本次海报主题为「${themeText}」，请结合标题和副标题生成画面描述。`
                    : '请根据当前标题和副标题生成一条封面画面描述。'

                  const res = await fetch(`${API_BASE}/api/doubao`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      systemPrompt: PROMPT_FOR_DOUBAO,
                      userPrompt,
                      title,
                      subtitle,
                      theme: themeText,
                    }),
                  })
                  if (!res.ok) {
                    const nonJsonHint = assertDoubaoJsonResponse(res)
                    if (nonJsonHint) {
                      showApiErrorToast({
                        title: '随机生成文案失败',
                        data: { hint: nonJsonHint },
                        httpStatus: res.status,
                      })
                      throw new Error('api_error')
                    }
                    const data = await res.json().catch(() => ({}))
                    showApiErrorToast({ title: '随机生成文案失败', data, httpStatus: res.status })
                    throw new Error('api_error')
                  }
                  const nonJsonHint = assertDoubaoJsonResponse(res)
                  if (nonJsonHint) {
                    showApiErrorToast({
                      title: '随机生成文案失败',
                      data: { hint: nonJsonHint },
                      httpStatus: res.status,
                    })
                    throw new Error('api_error')
                  }
                  const data = await res.json()
                  const text = data?.text
                  if (!text || typeof text !== 'string') {
                    showApiErrorToast({
                      title: '随机生成文案失败',
                      data: { hint: '豆包返回内容为空' },
                      httpStatus: res.status,
                    })
                    throw new Error('api_error')
                  }
                  return text
                }}
                onGenerate={async (prompt) => {
                  try {
                    const refUrl = referenceImageUrl.trim() || null
                    const urls = await generateImageWithJiMeng(prompt, refUrl)
                    const results = urls.slice(0, 4)
                    setBackgroundImages(results)
                    if (results[0]) {
                      setImageUrl(results[0])
                      setSelectedBackgroundIndex(0)
                    } else {
                      setSelectedBackgroundIndex(-1)
                    }
                  } catch (e) {
                    if (!(e instanceof Error && e.message === 'api_error')) {
                      showApiErrorToast({
                        title: '生成图片失败',
                        data: { message: e instanceof Error ? e.message : String(e) },
                      })
                    }
                  }
                }}
              />
            </div>

            <div className="backgroundSection">
              <span className="backgroundSection__label">4、选择封面背景</span>
              <div className="backgroundGrid">
                {Array.from({ length: 4 }).map((_, index) => {
                  const url = backgroundImages[index]
                  const isActive = index === selectedBackgroundIndex
                  return (
                    <div
                      key={index}
                      className={`backgroundGrid__item${isActive ? ' backgroundGrid__item--active' : ''}`}
                      onClick={() => {
                        if (url) {
                          setSelectedBackgroundIndex(index)
                          setImageUrl(url)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {url && <img src={url} alt={`封面背景 ${index + 1}`} />}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </div>

        {/* 右侧:封面预览 */}
        <aside className="demoPage__preview">
          <div className="previewCard">
            <h2 className="previewCard__title">封面预览</h2>
            <div className="previewCard__poster" ref={posterRef}>
              <PosterPreview
                title={title.trim() || '标题预览'}
                subtitle={subtitle.trim() || undefined}
                imageUrl={imageUrl}
              />
            </div>
          </div>
        </aside>
      </div>
      )}
    </div>
  )
}
