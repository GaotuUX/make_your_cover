type ImageUploadInputProps = {
  value?: string | null
  onChange: (imageBase64: string | null) => void
}

export function ImageUploadInput({ value, onChange }: ImageUploadInputProps) {
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      onChange(null)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null
      onChange(result)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="control">
      <span className="control__label">垫图上传</span>
      <div className="imageUpload">
        <input
          className="control__input"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />
        {value && (
          <div className="imageUpload__preview">
            <img src={value} alt="垫图预览" />
          </div>
        )}
      </div>
    </div>
  )
}

