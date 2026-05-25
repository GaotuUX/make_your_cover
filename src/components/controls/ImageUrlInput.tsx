type ImageUrlInputProps = {
  value?: string | null
  onChange: (url: string | null) => void
}

export function ImageUrlInput({ value, onChange }: ImageUrlInputProps) {
  return (
    <div className="control">
      <label className="control__label">参考图 URL</label>
      <input
        className="control__input"
        type="url"
        placeholder="请输入图片 URL，例如 https://example.com/image.png"
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value.trim()
          onChange(v || null)
        }}
      />
      {value && (
        <div className="imageUpload__preview">
          <img src={value} alt="参考图预览" onError={() => onChange(null)} />
        </div>
      )}
    </div>
  )
}
