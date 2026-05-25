import './schemeSwitch.css'

type Props = {
  schemeTwo: boolean
  onChange: (value: boolean) => void
}

export function SchemeSwitch({ schemeTwo, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={schemeTwo}
      aria-label={schemeTwo ? '当前为方案二' : '当前为方案一'}
      className={`schemeSwitch${schemeTwo ? ' schemeSwitch--on' : ''}`}
      onClick={() => onChange(!schemeTwo)}
    >
      <span className="schemeSwitch__thumb" />
    </button>
  )
}
