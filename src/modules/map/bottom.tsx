import { useMemo, useState } from 'react'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import type { Cast, ChartDataset, Coordinate } from '../../shared/model'
import { Sheet } from '../../shared/ui'
import { distanceMeters, localMeters } from './geometry'
import { convexHull, estimateDepth } from './depth-model'
import { BottomCanvas, type DepthPlot } from './bottom-canvas'
import { DepthSources } from './depth-sources'

export type DepthPoint = { id: string; position: Coordinate; meters: number; observedAt: string; source: string }
export function observedDepths(casts: Cast[]): DepthPoint[] {
  return casts.flatMap(cast => cast.depthPosition && cast.depth && cast.depth.source !== 'chart' && Number.isFinite(cast.depth.meters) && cast.depth.meters >= 0
    ? [{ id: cast.id, position: cast.depthPosition, meters: cast.depth.meters, observedAt: cast.depth.observedAt, source: cast.depth.source }] : [])
}
const SIZE = 320
export function BottomView({ casts, charts, station }: { casts: Cast[]; charts: ChartDataset[]; station: Coordinate | null }) {
  const [mode, setMode] = useState<'plan' | 'profile' | 'space'>('plan')
  const [rotation, setRotation] = useState(35)
  const [dataset, setDataset] = useState('own')
  const [model, setModel] = useState(false)
  const [gap, setGap] = useState(25)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const chart = charts.find(item => item.id === dataset)
  const modeName = mode === 'plan' ? 'Сверху' : mode === 'profile' ? 'По дальности' : '3D схема'
  const allPoints: DepthPoint[] = useMemo(() => chart ? chart.points.map((point, i) => ({ id: String(i), position: point.position, meters: point.depthM, source: chart.source, observedAt: chart.importedAt })) : observedDepths(casts), [chart, casts])
  // Bound the local preview and interpolation work; larger datasets remain intact in storage.
  const points = useMemo(() => allPoints.slice(0, 1000), [allPoints])
  const origin = chart ? points[0]?.position : station ?? points[0]?.position
  const positions = useMemo(() => origin ? points.map(point => ({ ...point, ...localMeters(origin, point.position) })) : [], [origin, points])
  const maxAxis = Math.max(20, ...positions.map(point => Math.max(Math.abs(point.east), Math.abs(point.north)))) * 1.2
  const maxDepth = Math.max(2, ...points.map(point => point.meters))
  const xy = (east: number, north: number) => ({ x: SIZE / 2 + east / maxAxis * 135, y: SIZE / 2 - north / maxAxis * 135 })
  const angle = rotation * Math.PI / 180
  const project3 = (east: number, north: number, depth: number) => ({
    x: 160 + (east * Math.cos(angle) - north * Math.sin(angle)) / maxAxis * 104,
    y: 100 + (east * Math.sin(angle) + north * Math.cos(angle)) / maxAxis * 45 + depth / maxDepth * 125,
  })
  const maxDistance = Math.max(20, ...points.map(point => origin ? distanceMeters(origin, point.position) : 0))
  const hull = useMemo(() => model ? convexHull(positions) : [], [model, positions])
  const step = maxAxis * 2 / 24
  // Rotation changes projection only; avoid repeating spatial interpolation on every drag frame.
  const cells = useMemo(() => {
    const result: { east: number; north: number; meters: number }[] = []
    if (model && hull.length >= 3 && mode !== 'profile') {
      for (let east = -maxAxis; east < maxAxis; east += step) for (let north = -maxAxis; north < maxAxis; north += step) {
        const meters = estimateDepth(positions, hull, east + step / 2, north + step / 2, gap)
        if (meters !== null && [[0, 0], [step, 0], [step, step], [0, step]].every(([dx, dy]) => estimateDepth(positions, hull, east + dx, north + dy, gap) !== null)) result.push({ east, north, meters })
      }
    }
    return result
  }, [model, hull, mode, maxAxis, step, positions, gap])
  const plane = [[-maxAxis, -maxAxis], [maxAxis, -maxAxis], [maxAxis, maxAxis], [-maxAxis, maxAxis]].map(([east, north]) => project3(east, north, 0))
  const color = (depth: number) => `hsl(192 32% ${83 - depth / maxDepth * 37}%)`
  const plot: DepthPlot = {
    points: positions.map(point => ({ ...point, ...(mode === 'plan' ? xy(point.east, point.north)
      : mode === 'space' ? project3(point.east, point.north, point.meters)
        : { x: 30 + (origin ? distanceMeters(origin, point.position) : 0) / maxDistance * 245, y: 52 + point.meters / maxDepth * 210 }) })),
    cells: cells.map(cell => ({ color: color(cell.meters), corners: [[0, 0], [step, 0], [step, step], [0, step]].map(([dx, dy]) => mode === 'space'
      ? project3(cell.east + dx, cell.north + dy, cell.meters) : xy(cell.east + dx, cell.north + dy)) })),
    plane: mode === 'space' ? plane : [],
    lines: mode === 'plan' ? [{ from: { x: 160, y: 10 }, to: { x: 160, y: 310 }, dashed: true }, { from: { x: 10, y: 160 }, to: { x: 310, y: 160 }, dashed: true }]
      : mode === 'profile' ? [{ from: { x: 27, y: 45 }, to: { x: 27, y: 275 }, dashed: true }, { from: { x: 27, y: 45 }, to: { x: 300, y: 45 } }]
        : positions.map(point => ({ from: project3(point.east, point.north, 0), to: project3(point.east, point.north, point.meters), dashed: true })),
    labels: mode === 'plan' ? [{ at: { x: 160, y: 18 }, text: 'С' }, { at: { x: 15, y: 292 }, text: `Ширина ≈ ${Math.round(maxAxis * 2)} м` }]
      : mode === 'profile' ? [{ at: { x: 30, y: 30 }, text: `${chart ? 'Ноль карты' : 'Поверхность воды'} · 0 м` }, { at: { x: 30, y: 292 }, text: `0 — ${Math.round(maxDistance)} м от ${chart ? 'первой точки' : 'станции'}` }] : [],
    station: mode === 'plan' && !chart && station ? xy(0, 0) : null,
  }
  return <section className="map-bottom">
    <div className="map-bottom__toolbar">
      <div className="map-bottom__summary"><strong>{modeName}</strong><span>{chart?.name ?? 'Мои промеры этой рыбалки'}</span></div>
      {points.length > 0 && <DepthSources />}
      <button type="button" className="map-bottom__settings" aria-label="Настройки рельефа" title="Настройки рельефа" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={21} /></button>
    </div>
    {!points.length ? <div className="map-bottom__empty"><strong>Добавьте первые глубины</strong><p>Сохраните промер с глубиной и её точкой в журнале или импортируйте свои точки GeoJSON.</p><DepthSources text /><p className="map-hint">Нашли официальный лист Одры для района Цегелинки — его можно открыть отдельно.</p></div> : <>
      <BottomCanvas key={`${dataset}:${mode}`} plot={plot} label={`${mode === 'plan' ? 'План' : mode === 'profile' ? 'Глубина по дальности' : 'Объёмная схема'} ${points.length} точек глубин`} rotate={mode === 'space' ? degrees => setRotation(current => (current + degrees + 360) % 360) : undefined} />
      <p className="depth-summary">{points.length} из {allPoints.length} точек{mode === 'space' ? ` · вертикаль ×${(125 * maxAxis / (104 * maxDepth)).toFixed(1)}` : ''}{mode === 'profile' ? ' · разные направления, не разрез дна' : ''}{model && mode !== 'profile' ? cells.length ? ' · цвет — оценка поверхности' : ' · для поверхности мало данных' : ''}</p>
    </>}
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen} title="Настройки рельефа">
      <fieldset className="map-bottom__choices"><legend>Вид</legend>
        {([['plan', 'Сверху'], ['profile', 'По дальности'], ['space', '3D схема']] as const).map(([value, label]) => <label key={value}><input type="radio" name="bottom-view" checked={mode === value} onChange={() => setMode(value)} /><span>{label}</span></label>)}
      </fieldset>
      <fieldset className="map-bottom__choices"><legend>Источник глубин</legend>
        <label><input type="radio" name="bottom-source" checked={dataset === 'own'} onChange={() => { setDataset('own'); setModel(false) }} /><span>Мои промеры этой рыбалки</span></label>
        {charts.map(item => <label key={item.id}><input type="radio" name="bottom-source" checked={dataset === item.id} onChange={() => { setDataset(item.id); setModel(false) }} /><span>{item.name}</span></label>)}
      </fieldset>
      {chart && <p className="map-hint">{chart.source} · отсчёт: {chart.verticalDatum}. Карточные значения показаны отдельно от сегодняшних измерений.</p>}
      <p className="map-hint">Положение глубин подтверждено пользователем; точность координат не оценена. На экране до 1000 точек, весь набор остаётся в журнале. В 3D вертикальный масштаб увеличен для чтения глубин; коэффициент указан под схемой.</p>
      {mode === 'space' && <label className="map-bottom__rotation">Поворот схемы: {Math.round(rotation)}°<input type="range" min="0" max="360" value={rotation} onChange={event => setRotation(Number(event.target.value))} /></label>}
      {points.length >= 3 && <div className="map-bottom__model"><strong>Предполагаемая поверхность</strong>
        <p className="map-hint">Взвешенная оценка по соседним глубинам внутри области точек. Берега автоматически не распознаются. Включайте только для одного водного участка с сопоставимым уровнем воды.</p>
        <label className="survey-check"><input type="checkbox" checked={model} onChange={event => setModel(event.target.checked)} />Точки одного водного участка и уровня воды — показать оценку</label>
        {model && <><label className="map-bottom__rotation">Искать соседей не дальше {gap} м<input type="range" min="5" max="100" step="5" value={gap} onChange={event => setGap(Number(event.target.value))} /></label><p className="map-hint">Цветные участки — предположение, не измерения. Пустые места не заполнены: данных недостаточно. Числовая погрешность не оценена.</p></>}
      </div>}
    </Sheet>
  </section>
}
