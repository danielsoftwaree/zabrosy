import { NavigationArrow } from '@phosphor-icons/react/dist/csr/NavigationArrow'
import { MapTrifold } from '@phosphor-icons/react/dist/csr/MapTrifold'
import { Cube } from '@phosphor-icons/react/dist/csr/Cube'
import { Camera } from '@phosphor-icons/react/dist/csr/Camera'
import { SurveyPanel } from '../modules/survey'
import { MapPanel } from '../modules/map'
import { useFieldUi } from '../shared/ui/field-ui'

export function FieldScreen() {
  const view = useFieldUi((state) => state.view)
  const setView = useFieldUi((state) => state.setView)
  return <>
    <nav className="view-switch" aria-label="Вид карты">
      <button aria-label="Сектор" aria-pressed={view === 'sector'} onClick={() => setView('sector')}><NavigationArrow size={18} /><span>Сектор</span></button>
      <button aria-label="Снимок" aria-pressed={view === 'aerial'} onClick={() => setView('aerial')}><MapTrifold size={18} /><span>Снимок</span></button>
      <button aria-label="3D" aria-pressed={view === 'bottom'} onClick={() => setView('bottom')}><Cube size={18} /><span>3D</span></button>
      <button aria-label="Камера" aria-pressed={view === 'camera'} onClick={() => setView('camera')}><Camera size={18} /><span>Фото</span></button>
    </nav>
    <MapPanel view={view}>{(mapSurface, mapFooter) => <SurveyPanel surface={view === 'sector' ? undefined : mapSurface} footer={view === 'aerial' ? mapFooter : null} />}</MapPanel>
  </>
}
