import { useState } from 'react'
import { SchemeTwoPage } from './components/SchemeTwoPage'

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

export default function App() {
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)

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
    <div className="demoPage">
      <header className="navBar">
        <div className="navBar__leading" aria-hidden />
        <h1 className="navBar__title">封面设计</h1>
        <button
          type="button"
          className="navBar__export"
          onClick={handleExport}
          disabled={!coverPreviewUrl}
        >
          导出封面
        </button>
      </header>

      <SchemeTwoPage onCoverPreviewUrlChange={setCoverPreviewUrl} />
    </div>
  )
}
