import './posterPreview.css'
import { titleGridUrl } from '../../config/titleBg'

export type PosterPreviewProps = {
  title: string
  subtitle?: string
  imageUrl: string
  className?: string
}

export function PosterPreview({ title, subtitle, imageUrl, className }: PosterPreviewProps) {
  return (
    <div className={['posterPreview', className].filter(Boolean).join(' ')}>
      <div className="posterPreview__imageContainer">
        <img className="posterPreview__image" alt="" src={imageUrl} />
      </div>

      <div className="posterPreview__titleBg" aria-hidden>
        <img className="posterPreview__titleGrid" alt="" src={titleGridUrl} />
      </div>

      <div className="posterPreview__titleGroup">
        <div className="posterPreview__titleMain">
          <div className="posterPreview__titleStroke" aria-hidden="true">
            {title}
          </div>
          <div className="posterPreview__titleFill">{title}</div>
        </div>

        {subtitle != null && subtitle.trim() !== '' ? (
          <div className="posterPreview__subtitle">{subtitle}</div>
        ) : null}
      </div>
    </div>
  )
}

