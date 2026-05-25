import { useEffect, useRef, useState } from 'react'
import type { CoverThemeSelection } from '../../data/coverTemplates'
import { CoverThemePicker } from './CoverThemePicker'
import './coverThemeField.css'

type Props = {
  value: CoverThemeSelection | null
  onChange: (v: CoverThemeSelection | null) => void
}

function formatTheme(sel: CoverThemeSelection | null) {
  if (!sel) return ''
  return `${sel.level1} · ${sel.level2} · ${sel.level3}`
}

export function CoverThemeField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="coverThemeField__wrap" ref={wrapRef}>
      <div className="titleRow__field">
        <span className="titleRow__label">1、选择封面主题</span>
        <button
          type="button"
          className={`titleRow__input coverThemeField__trigger${!value ? ' coverThemeField__trigger--placeholder' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {value ? formatTheme(value) : '点击选择'}
        </button>
      </div>
      {open && (
        <CoverThemePicker
          onPick={(sel) => {
            onChange(sel)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
