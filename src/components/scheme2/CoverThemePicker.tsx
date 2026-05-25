import { useState } from 'react'
import { COVER_THEME_TAXONOMY } from '../../data/coverThemeTaxonomy'
import type { CoverThemeSelection } from '../../data/coverTemplates'
import './coverThemePicker.css'

type Props = {
  onPick: (sel: CoverThemeSelection) => void
}

export function CoverThemePicker({ onPick }: Props) {
  const [l1Name, setL1Name] = useState(() => COVER_THEME_TAXONOMY[0]?.name ?? '')
  const [l2Name, setL2Name] = useState(() => COVER_THEME_TAXONOMY[0]?.level2[0]?.name ?? '')

  const l1 = COVER_THEME_TAXONOMY.find((x) => x.name === l1Name) ?? COVER_THEME_TAXONOMY[0]
  const l2List = l1?.level2 ?? []
  const l2 = l2List.find((x) => x.name === l2Name) ?? l2List[0]

  const l3List = l2?.level3 ?? []

  const handleL1 = (name: string) => {
    setL1Name(name)
    const next = COVER_THEME_TAXONOMY.find((x) => x.name === name)
    const firstL2 = next?.level2[0]
    setL2Name(firstL2?.name ?? '')
  }

  const handleL3 = (level3: string) => {
    if (!l1 || !l2) return
    onPick({
      level1: l1.name,
      level2: l2.name,
      level3,
    })
  }

  return (
    <div className="coverThemePicker" role="listbox" aria-label="封面主题">
      <div className="coverThemePicker__col coverThemePicker__col--l1">
        {COVER_THEME_TAXONOMY.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`coverThemePicker__row--l1${item.name === l1Name ? ' coverThemePicker__row--activeL1' : ''}`}
            onClick={() => handleL1(item.name)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="coverThemePicker__col coverThemePicker__col--l2">
        {l2List.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`coverThemePicker__row--l2${item.name === l2Name ? ' coverThemePicker__row--active' : ''}`}
            onClick={() => setL2Name(item.name)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="coverThemePicker__col coverThemePicker__col--l3">
        {l3List.map((item) => (
          <button
            key={`${l2Name}-${item.name}`}
            type="button"
            className="coverThemePicker__row--l3"
            onClick={() => handleL3(item.name)}
          >
            {item.name}
          </button>
        ))}
      </div>
    </div>
  )
}
