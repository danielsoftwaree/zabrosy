import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MapTrifold } from '@phosphor-icons/react/dist/csr/MapTrifold'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/csr/ArrowSquareOut'
import { Sheet } from '../../shared/ui'
import { parseEncChart } from './enc-chart'
import { useEncChart } from './enc-chart-store'
import { useMapTools } from './map-tools'
import './bottom.css'

export function DepthSources({ text = false }: { text?: boolean }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const chart = useEncChart(state => state.chart)
  const setChart = useEncChart(state => state.setChart)
  const selectDataset = useMapTools(state => state.selectDataset)
  async function openFile(file: File | undefined) {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const parsed = await parseEncChart(file.name, await file.arrayBuffer())
      setChart(parsed)
      selectDataset(parsed.id)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть карту.')
    } finally {
      setLoading(false)
    }
  }
  return <>
    <button type="button" className={text ? 'depth-sources__open' : 'map-bottom__settings'} aria-label="Карты глубин Одры" title="Карты глубин Одры" onClick={() => setOpen(true)}><MapTrifold size={21} />{text && 'Карты глубин Одры'}</button>
    <Sheet open={open} onOpenChange={setOpen} title="Карты Одры · Щецин">
      <div className="depth-sources">
        <h3>Цегелинка · ENC P17OD735</h3>
        <p>Откройте лист прямо здесь: области глубин появятся поверх снимка, изобаты — также на схеме дна. Карта загружается только в эту вкладку.</p>
        <a className="depth-sources__link" href="https://www.szczecin.uzs.gov.pl/wp-content/uploads/2026/05/P17OD735.zip" target="_blank" rel="noopener noreferrer">Скачать официальный лист · ZIP, 310 КБ <ArrowSquareOut size={18} /></a>
        <label className="depth-sources__file">{loading ? 'Открываю карту…' : 'Открыть скачанный ZIP или .000'}<input type="file" accept=".zip,.000,application/zip,application/octet-stream" disabled={loading} onChange={event => { void openFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
        {error && <p className="depth-sources__error" role="alert">{error}</p>}
        {chart && <p className="depth-sources__note">Открыт {chart.name}: {chart.areas.length} областей, {chart.contours.length} изобат, {chart.soundings.length} промеров. После закрытия вкладки лист нужно открыть снова.</p>}
        <p className="depth-sources__note">Публикация файла: 14 мая 2026. Это не дата промера дна. Отсчёт карточных глубин нужно сверять с уровнем воды; они не показывают автоматически сегодняшнюю глубину.</p>
        <a className="depth-sources__link" href="https://www.szczecin.uzs.gov.pl/ris-odra/elektroniczne-mapy-nawigacyjne/pobierz-mapy/" target="_blank" rel="noopener noreferrer">Другие листы Одры и условия использования <ArrowSquareOut size={18} /></a>
        <p className="depth-sources__note">УЗС разрешает просмотр карты. Сохранение и распространение её содержимого требует письменного согласия; Маркер показывает выбранный лист локально и не добавляет его в журнал или резервную копию.</p>
        <Link className="depth-sources__link" to="/journal" hash="depths" onClick={() => setOpen(false)}>Импортировать свои точки GeoJSON</Link>
      </div>
    </Sheet>
  </>
}
