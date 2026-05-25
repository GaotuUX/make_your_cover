type TitleInputProps = {
  value: string
  onChange: (value: string) => void
}

export function TitleInput({ value, onChange }: TitleInputProps) {
  return (
    <label className="control">
      <span className="control__label">海报标题</span>
      <input
        className="control__input"
        type="text"
        placeholder="请输入海报标题"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

