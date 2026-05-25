import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { parseApiErrorResponse, type ApiErrorDisplay } from '../../utils/parseApiErrorResponse'
import './toast.css'

export type ToastItem = {
  id: string
  title: string
  lines: string[]
}

type ShowApiErrorOptions = {
  title: string
  data?: unknown
  httpStatus?: number
  /** 默认 8s */
  durationMs?: number
}

type ToastContextValue = {
  showApiError: (opts: ShowApiErrorOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let imperativeShowApiError: ((opts: ShowApiErrorOptions) => void) | null = null

/** 供非 React 模块（如 uploadImage）调用 */
export function showApiErrorToast(opts: ShowApiErrorOptions) {
  imperativeShowApiError?.(opts)
}

function buildToastLines(parsed: ApiErrorDisplay): string[] {
  const lines: string[] = []
  if (parsed.httpStatus != null) {
    lines.push(`HTTP 状态：${parsed.httpStatus}`)
  }
  if (parsed.code) {
    lines.push(`错误码：${parsed.code}`)
  }
  if (parsed.type) {
    lines.push(`类型：${parsed.type}`)
  }
  if (parsed.meaning) {
    lines.push(`说明：${parsed.meaning}`)
  } else if (parsed.hint) {
    lines.push(`说明：${parsed.hint}`)
  }
  return lines
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const t = timersRef.current.get(id)
    if (t) {
      clearTimeout(t)
      timersRef.current.delete(id)
    }
  }, [])

  const showApiError = useCallback(
    (opts: ShowApiErrorOptions) => {
      const parsed = parseApiErrorResponse(opts.data, opts.httpStatus)
      const lines = buildToastLines(parsed)
      if (lines.length === 0) {
        lines.push('请查看网络或后端日志')
      }
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setItems((prev) => [...prev.slice(-4), { id, title: opts.title, lines }])
      const duration = opts.durationMs ?? 8000
      const timer = setTimeout(() => dismiss(id), duration)
      timersRef.current.set(id, timer)
    },
    [dismiss],
  )

  useEffect(() => {
    imperativeShowApiError = showApiError
    return () => {
      imperativeShowApiError = null
      timersRef.current.forEach((t) => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [showApiError])

  const value = useMemo(() => ({ showApiError }), [showApiError])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toastViewport" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <div key={item.id} className="toastItem" role="alert">
            <div className="toastItem__title">{item.title}</div>
            {item.lines.map((line) => (
              <div key={line} className="toastItem__row">
                {line}
              </div>
            ))}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast 须在 ToastProvider 内使用')
  }
  return ctx
}
