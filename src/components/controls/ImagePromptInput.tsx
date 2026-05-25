import { useState } from 'react'
import { useToast } from '../Toast/ToastProvider'

type ImagePromptInputProps = {
  disabled?: boolean
  randomDisabled?: boolean
  onGenerate: (prompt: string) => Promise<void> | void
  onRandomGenerate?: () => Promise<string>
}

export function ImagePromptInput({ disabled, randomDisabled, onGenerate, onRandomGenerate }: ImagePromptInputProps) {
  const { showApiError } = useToast()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [randomLoading, setRandomLoading] = useState(false)

  async function handleRandomClick() {
    if (!onRandomGenerate || randomLoading || loading || disabled || randomDisabled) return
    try {
      setRandomLoading(true)
      const text = await onRandomGenerate()
      setPrompt(text)
    } catch (e) {
      if (!(e instanceof Error && e.message === 'api_error')) {
        showApiError({
          title: '随机生成文案失败',
          data: { message: e instanceof Error ? e.message : String(e) },
        })
      }
    } finally {
      setRandomLoading(false)
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = prompt.trim()
    if (!trimmed || loading || disabled) return
    try {
      setLoading(true)
      await onGenerate(trimmed)
    } finally {
      setLoading(false)
    }
  }

  const isBusy = loading || randomLoading

  return (
    <form className="describeBlock" onSubmit={handleGenerate}>
      <div className="describeRow">
        <div className="describeRow__head">
          <span className="describeRow__label">3、描述封面内容</span>
          <p className="describeRow__hint">参考"老师穿着休闲服饰在图书馆看书"</p>
        </div>
        <div className="describeRow__btns">
          <button
            type="button"
            className="btnSecondary"
            onClick={handleRandomClick}
            disabled={disabled || randomDisabled || isBusy}
          >
            {randomLoading ? '生成中…' : '随机生成文案'}
          </button>
          <button
            type="submit"
            className="btnPrimary"
            disabled={disabled || isBusy || !prompt.trim()}
          >
            {loading ? '生成中…' : '生成图片'}
          </button>
        </div>
      </div>
      <textarea
        className="promptInput"
        placeholder="输入文案"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={disabled || isBusy}
        rows={4}
      />
    </form>
  )
}
