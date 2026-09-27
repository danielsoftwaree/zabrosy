import { unzipSync } from 'fflate'
import type { Coordinate } from '../../shared/model'

export type EncArea = { rings: Coordinate[][]; shallowM: number | null; deepM: number | null }
export type EncContour = { positions: Coordinate[]; depthM: number }
export type EncSounding = { position: Coordinate; depthM: number }
export type EncChart = {
  id: 'enc-current'
  name: string
  source: string
  verticalDatum: string
  areas: EncArea[]
  contours: EncContour[]
  soundings: EncSounding[]
}

const MAX_FILE = 12_000_000
const coord = ([lon, lat]: [number, number]): Coordinate => ({ lon, lat })
const finiteDepth = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const n = Number(value)
  return Number.isFinite(n) && n >= -100 && n <= 10_000 ? n : null
}

export function encBytes(fileName: string, bytes: Uint8Array): { name: string; bytes: Uint8Array } {
  if (bytes.byteLength > MAX_FILE) throw new Error('Файл слишком большой (максимум 12 МБ).')
  if (/\.000$/i.test(fileName)) return { name: fileName, bytes }
  if (!/\.zip$/i.test(fileName)) throw new Error('Выберите лист ENC .000 или архив .zip с этим листом.')
  let files: Record<string, Uint8Array>
  let count = 0
  let tooLarge = false
  let hasUpdates = false
  try {
    files = unzipSync(bytes, { filter: entry => {
      if (/[A-Z0-9]{8}\.(?!000)\d{3}$/i.test(entry.name)) hasUpdates = true
      if (!/\.000$/i.test(entry.name)) return false
      count++
      if (entry.originalSize > MAX_FILE) tooLarge = true
      return count === 1 && !tooLarge
    } })
  } catch {
    throw new Error('ZIP не удалось прочитать. Выберите официальный архив или файл .000.')
  }
  if (tooLarge) throw new Error('Лист в ZIP слишком большой (максимум 12 МБ).')
  if (count > 1) throw new Error('В ZIP несколько листов. Откройте один файл .000.')
  if (hasUpdates) throw new Error('В архиве есть обновления ENC .001–.999; этот просмотрщик их пока не применяет. Откройте актуальный базовый лист отдельно.')
  const matches = Object.entries(files)
  if (matches.length !== 1) throw new Error(matches.length ? 'В архиве несколько листов. Откройте один файл .000.' : 'В ZIP нет файла карты .000.')
  const [name, content] = matches[0]
  return { name: name.split('/').at(-1) ?? name, bytes: content }
}

// Viewer-only decode: geometry lives in memory and is never written to FieldData or backup.
export async function parseEncChart(fileName: string, buffer: ArrayBuffer): Promise<EncChart> {
  const { name, bytes } = encBytes(fileName, new Uint8Array(buffer))
  const [{ parseS57, toGeoJSON, spatialKey }, { parse: parseISO8211 }] = await Promise.all([import('@s57-parser/s57'), import('@s57-parser/iso8211')])
  let dataset: ReturnType<typeof parseS57>
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  let parameters: ReturnType<typeof parseISO8211>['records'][number]['fields'][number]['subfields'] | undefined
  try {
    parameters = parseISO8211(data).records.flatMap(record => record.fields).find(field => field.tag === 'DSPM')?.subfields
  } catch {
    throw new Error('Не удалось прочитать ENC. Нужен открытый лист S-57 .000, не защищённый S-63.')
  }
  if (!parameters) throw new Error('Не удалось прочитать ENC. Нужен открытый лист S-57 .000, не защищённый S-63.')
  const value = (label: string) => parameters?.find(item => item.label === label)?.value
  if (value('DUNI') !== 1) throw new Error('Глубины в этом ENC указаны не в метрах; этот лист нельзя показать корректно.')
  if (value('COUN') !== 1 || value('HDAT') !== 2) throw new Error('Координаты ENC не в WGS 84; наложение на снимок было бы неверным.')
  const soundingDatum = Number(value('SDAT'))
  try {
    dataset = parseS57(data)
  } catch {
    throw new Error('Не удалось прочитать геометрию листа S-57 .000.')
  }
  if (!dataset.features.length || !dataset.comf) throw new Error('В файле не найдена читаемая карта S-57.')
  const areas: EncArea[] = []
  const contours: EncContour[] = []
  // IHO S-57 Appendix A: DRVAL1=87, DRVAL2=88, VALDCO=174. The third-party
  // package's convenience ATTL table has incorrect DRVAL codes; use raw labels.
  for (const feature of toGeoJSON(dataset, [42, 43]).features) {
    if (feature.properties.OBJL === 42 && feature.geometry?.type === 'Polygon') {
      const shallowM = finiteDepth(feature.properties.ATTL_87)
      const deepM = finiteDepth(feature.properties.ATTL_88)
      if (shallowM !== null || deepM !== null) areas.push({ rings: feature.geometry.coordinates.map(ring => ring.map(coord)), shallowM, deepM })
    }
    if (feature.properties.OBJL === 43 && feature.geometry?.type === 'LineString') {
      const depthM = finiteDepth(feature.properties.ATTL_174)
      if (depthM !== null) contours.push({ positions: feature.geometry.coordinates.map(coord), depthM })
    }
  }
  const soundings: EncSounding[] = []
  for (const feature of dataset.features.filter(item => item.objl === 129)) {
    for (const ref of feature.spatialRefs) {
      const spatial = dataset.spatialRecords.get(spatialKey(ref.rcnm, ref.rcid))
      for (const point of spatial?.coordinates3D ?? []) {
        if (Number.isFinite(point.depth)) soundings.push({ position: { lat: point.lat, lon: point.lon }, depthM: point.depth })
      }
    }
  }
  if (!areas.length && !contours.length && !soundings.length) throw new Error('В этом листе нет читаемых областей, изобат или точек глубины.')
  const verticalDatum = soundingDatum === 33 ? 'местный средний уровень воды (S-57 SDAT 33); конкретный пост уточните у источника' : Number.isFinite(soundingDatum) ? `код S-57 SDAT ${soundingDatum}; уточните у источника` : 'не указан; уточните у источника'
  return { id: 'enc-current', name: name.replace(/\.000$/i, ''), source: `Локальный ENC ${name}`, verticalDatum, areas, contours, soundings }
}

export function encFeatureCollection(chart: EncChart) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...chart.areas.map(area => ({ type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: area.rings.map(ring => ring.map(point => [point.lon, point.lat])) }, properties: { kind: 'area', shallowM: area.shallowM, deepM: area.deepM } })),
      ...chart.contours.map(contour => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: contour.positions.map(point => [point.lon, point.lat]) }, properties: { kind: 'contour', depthM: contour.depthM } })),
      ...chart.soundings.map(sounding => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [sounding.position.lon, sounding.position.lat] }, properties: { kind: 'sounding', depthM: sounding.depthM } })),
    ],
  }
}

function ringContains(ring: Coordinate[], point: Coordinate): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lon < (b.lon - a.lon) * (point.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

export function areaAt(chart: EncChart, point: Coordinate): EncArea | null {
  return chart.areas.find(area => area.rings.length > 0 && ringContains(area.rings[0], point) && !area.rings.slice(1).some(ring => ringContains(ring, point))) ?? null
}
