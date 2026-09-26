import { useState } from 'react'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import type { Cast, ChartDataset, Coordinate } from '../../shared/model'
import { Sheet } from '../../shared/ui'
import { distanceMeters, localMeters } from './geometry'
import { convexHull, estimateDepth } from './depth-model'

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
  const allPoints: DepthPoint[] = chart ? chart.points.map((point, i) => ({ id: String(i), position: point.position, meters: point.depthM, source: chart.source, observedAt: chart.importedAt })) : observedDepths(casts)
  // ponytail: SVG preview is bounded; use tiled rendering if chart imports need more than 1000 simultaneous points.
  const points = allPoints.slice(0, 1000)
  const origin = chart ? points[0]?.position : station ?? points[0]?.position
  const positions = origin ? points.map(point => ({ ...point, ...localMeters(origin, point.position) })) : []
  const maxAxis = Math.max(20, ...positions.map(point => Math.max(Math.abs(point.east), Math.abs(point.north)))) * 1.2
  const maxDepth = Math.max(2, ...points.map(point => point.meters))
  const xy = (east: number, north: number) => ({ x: SIZE / 2 + east / maxAxis * 135, y: SIZE / 2 - north / maxAxis * 135 })
  const angle = rotation * Math.PI / 180
  const project3 = (east: number, north: number, depth: number) => ({
    x: 160 + (east * Math.cos(angle) - north * Math.sin(angle)) / maxAxis * 104,
    y: 100 + (east * Math.sin(angle) + north * Math.cos(angle)) / maxAxis * 45 + depth / maxDepth * 125,
  })
  const maxDistance = Math.max(20, ...points.map(point => origin ? distanceMeters(origin, point.position) : 0))
  const hull = model ? convexHull(positions) : []
  const cells: { east: number; north: number; meters: number }[] = []
  const step = maxAxis * 2 / 24
  if (model && hull.length >= 3 && mode !== 'profile') {
    for (let east = -maxAxis; east < maxAxis; east += step) for (let north = -maxAxis; north < maxAxis; north += step) {
      const meters = estimateDepth(positions, hull, east + step / 2, north + step / 2, gap)
      if (meters !== null && [[0, 0], [step, 0], [step, step], [0, step]].every(([dx, dy]) => estimateDepth(positions, hull, east + dx, north + dy, gap) !== null)) cells.push({ east, north, meters })
    }
  }
  const plane = [[-maxAxis, -maxAxis], [maxAxis, -maxAxis], [maxAxis, maxAxis], [-maxAxis, maxAxis]].map(([east, north]) => project3(east, north, 0))
  const color = (depth: number) => `hsl(192 32% ${83 - depth / maxDepth * 37}%)`
  return <section className="map-bottom">
    <div className="map-bottom__toolbar">
      <div className="map-bottom__summary"><strong>{modeName}</strong><span>{chart?.name ?? 'Мои промеры этой рыбалки'}</span></div>
      <button type="button" className="map-bottom__settings" aria-label="Настройки рельефа" title="Настройки рельефа" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={21} /></button>
    </div>
    {!points.length ? <div className="map-bottom__empty">Пока нет глубин с подтверждённым положением. Добавьте глубину в журнале и подтвердите её привязку к точке или импортируйте точки карты. Секунды падения остаются секундами.</div> : <>
      <svg className="map-bottom__plot" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${mode === 'plan' ? 'План' : mode === 'profile' ? 'Глубина по дальности' : 'Объёмная схема'} ${points.length} точек глубин`}>
        {mode === 'plan' && <>
          <line x1="160" y1="10" x2="160" y2="310" className="map-bottom__axis" /><line x1="10" y1="160" x2="310" y2="160" className="map-bottom__axis" />
          {cells.map((cell, i) => { const pos = xy(cell.east, cell.north + step); return <rect key={i} x={pos.x} y={pos.y} width={step / maxAxis * 135} height={step / maxAxis * 135} fill={color(cell.meters)} opacity=".65" /> })}
          <text x="160" y="18" textAnchor="middle" className="map-bottom__small">С</text>
          {!chart && station && <circle cx="160" cy="160" r="6" className="map-bottom__station" />}
          {positions.map(point => { const pos = xy(point.east, point.north); return <g key={point.id}><circle cx={pos.x} cy={pos.y} r="5" className="map-bottom__point"><title>{point.meters.toFixed(1)} м · {point.source} · {point.observedAt}</title></circle>{points.length <= 30 && <text x={Math.min(280, pos.x + 8)} y={pos.y - 8} className="map-bottom__label">{point.meters.toFixed(1)} м</text>}</g> })}
          <text x="15" y="307" className="map-bottom__small">Ширина ≈ {Math.round(maxAxis * 2)} м</text>
        </>}
        {mode === 'profile' && <>
          <line x1="27" y1="45" x2="27" y2="275" className="map-bottom__axis" /><line x1="27" y1="45" x2="300" y2="45" className="map-bottom__water" />
          <text x="30" y="30" className="map-bottom__small">{chart ? 'Ноль карты' : 'Поверхность воды'} · 0 м</text>
          {points.map(point => { const x = 30 + (origin ? distanceMeters(origin, point.position) : 0) / maxDistance * 245, y = 52 + point.meters / maxDepth * 210; return <g key={point.id}><line x1={x} y1="46" x2={x} y2={y} className="map-bottom__stem" /><circle cx={x} cy={y} r="5" className="map-bottom__point"><title>{point.meters.toFixed(1)} м</title></circle>{points.length <= 30 && <text x={Math.min(280, x + 7)} y={y - 7} className="map-bottom__label">{point.meters.toFixed(1)} м</text>}</g> })}
          <text x="30" y="299" className="map-bottom__small">0 — {Math.round(maxDistance)} м от {chart ? 'первой точки' : 'станции'}</text>
        </>}
        {mode === 'space' && <>
          <polygon points={plane.map(pos => `${pos.x},${pos.y}`).join(' ')} className="map-bottom__plane" />
          {cells.map((cell, i) => <polygon key={i} points={[[0, 0], [step, 0], [step, step], [0, step]].map(([dx, dy]) => { const p = project3(cell.east + dx, cell.north + dy, cell.meters); return `${p.x},${p.y}` }).join(' ')} fill={color(cell.meters)} opacity=".6" />)}
          {positions.map(point => { const top = project3(point.east, point.north, 0), bottom = project3(point.east, point.north, point.meters); return <g key={point.id}><line x1={top.x} y1={top.y} x2={bottom.x} y2={bottom.y} className="map-bottom__stem" /><circle cx={bottom.x} cy={bottom.y} r="5" className="map-bottom__point"><title>{point.meters.toFixed(1)} м</title></circle>{points.length <= 30 && <text x={Math.min(280, bottom.x + 8)} y={bottom.y - 8} className="map-bottom__label">{point.meters.toFixed(1)} м</text>}</g> })}
        </>}
      </svg>
      <p className="map-hint">Показано {points.length} из {allPoints.length} точек. {model && mode !== 'profile' ? cells.length ? 'Оценка поверхности: цветные участки предположительны. ' : 'Оценка поверхности включена, данных для окраски недостаточно. ' : ''}{mode === 'space' ? `Вертикальный масштаб ×${(125 * maxAxis / (104 * maxDepth)).toFixed(1)} относительно горизонтального. ` : ''}{mode === 'profile' ? 'Точки разных направлений показаны по дальности, это не непрерывный разрез дна. ' : ''}Положение глубин подтверждено пользователем; точность координат не оценена.</p>
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
      {mode === 'space' && <label className="map-bottom__rotation">Поворот схемы: {rotation}°<input type="range" min="0" max="360" value={rotation} onChange={event => setRotation(Number(event.target.value))} /></label>}
      {points.length >= 3 && <div className="map-bottom__model"><strong>Предполагаемая поверхность</strong>
        <p className="map-hint">Взвешенная оценка по соседним глубинам внутри области точек. Берега автоматически не распознаются. Включайте только для одного водного участка с сопоставимым уровнем воды.</p>
        <label className="survey-check"><input type="checkbox" checked={model} onChange={event => setModel(event.target.checked)} />Точки одного водного участка и уровня воды — показать оценку</label>
        {model && <><label className="map-bottom__rotation">Искать соседей не дальше {gap} м<input type="range" min="5" max="100" step="5" value={gap} onChange={event => setGap(Number(event.target.value))} /></label><p className="map-hint">Цветные участки — предположение, не измерения. Пустые места не заполнены: данных недостаточно. Числовая погрешность не оценена.</p></>}
      </div>}
    </Sheet>
  </section>
}
