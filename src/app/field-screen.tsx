import { useState } from 'react'
import { NavigationArrow } from '@phosphor-icons/react/dist/csr/NavigationArrow'
import { MapTrifold } from '@phosphor-icons/react/dist/csr/MapTrifold'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Camera } from '@phosphor-icons/react/dist/csr/Camera'
import { SurveyPanel } from '../modules/survey'
import { MapPanel } from '../modules/map'

export function FieldScreen() {
  const [view, setView] = useState<'sector' | 'aerial' | 'bottom' | 'camera'>('sector')
  return <>
    <nav className="view-switch" aria-label="Вид карты">
      <button aria-pressed={view === 'sector'} onClick={() => setView('sector')}><NavigationArrow size={18} />Сектор</button>
      <button aria-pressed={view === 'aerial'} onClick={() => setView('aerial')}><MapTrifold size={18} />Снимок</button>
      <button aria-pressed={view === 'bottom'} onClick={() => setView('bottom')}><Cube size={18} />3D</button>
      <button aria-pressed={view === 'camera'} onClick={() => setView('camera')}><Camera size={18} />AR</button>
    </nav>
    <SurveyPanel surface={view === 'sector' ? undefined : <MapPanel embedded view={view} />} />
  </>
}
