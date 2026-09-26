import { emptyFieldData, type Cast, type ChartDataset, type FieldData, type Session, type Station } from '../../shared/model'
import { validateFieldData } from '../../shared/storage'

export type Backup = { kind: 'marker-backup'; version: 1; exportedAt: string; data: FieldData }

export function parseBackup(text: string): FieldData {
  const input: unknown = JSON.parse(text)
  if (!input || typeof input !== 'object' || !('kind' in input) || input.kind !== 'marker-backup' ||
    !('version' in input) || input.version !== 1 || !('data' in input)) {
    throw new Error('Это не резервная копия Маркера текущего формата.')
  }
  return validateFieldData(input.data)
}

export type ImportPreview = { data: FieldData; warning: string | null }

function legacyCoordinate(value: unknown): { lat: number; lon: number } | null {
  if (!value || typeof value !== 'object' || !('lat' in value) || !('lng' in value)) return null
  const { lat, lng } = value
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180 ? { lat, lon: lng } : null
}

function legacyTimestamp(value: unknown, fallback: string) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback
}

function legacyNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

function parseLegacyV2(value: Record<string, unknown>, source: string): ImportPreview {
  if (!Array.isArray(value.casts) || value.casts.length > 1000) throw new Error('В старой копии неверное число забросов (максимум 1000).')
  const importedAt = new Date().toISOString()
  const settings = value.settings && typeof value.settings === 'object' ? value.settings as Record<string, unknown> : {}
  const pickup = legacyNumber(settings.pickup, 0.05, 3) ?? 0.8
  const bank = settings.geoAligned === true ? legacyCoordinate(settings.bank) : null
  const sessionStation: Station = {
    position: bank,
    accuracyM: null,
    referenceBearingDeg: bank ? legacyNumber(settings.bearing, 0, 360) : null,
  }
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 200) : 'Импортированная рыбалка'
  const session: Session = {
    id: crypto.randomUUID(), name: title,
    createdAt: legacyTimestamp(value.createdAt, importedAt), updatedAt: importedAt,
    station: sessionStation,
    calibration: { metersPerTurn: pickup, source: 'estimate', measuredLengthM: null, measuredTurns: null },
  }
  const casts: Cast[] = []
  let skipped = 0
  for (const valueCast of value.casts) {
    if (!valueCast || typeof valueCast !== 'object') { skipped++; continue }
    const old = valueCast as Record<string, unknown>
    const angle = legacyNumber(old.angle, -180, 180)
    const turns = legacyNumber(old.turns, 0, 10_000)
    if (angle === null || turns === null) { skipped++; continue }
    if (old.events !== undefined && !Array.isArray(old.events)) { skipped++; continue }
    const oldEvents = Array.isArray(old.events) ? old.events : []
    if (oldEvents.length > 2000) { skipped++; continue }
    const point = legacyCoordinate(old.origin)
    const station: Station = { position: point, accuracyM: null, referenceBearingDeg: point ? legacyNumber(old.referenceBearing, 0, 360) : null }
    const oldPickup = legacyNumber(old.pickup, 0.05, 3) ?? pickup
    const observations = oldEvents.slice(0, 100).map((event: unknown) => {
      if (!event || typeof event !== 'object') return 'неизвестная отметка'
      const item = event as Record<string, unknown>
      const turnsText = legacyNumber(item.turns, 0, 10_000)
      return `${String(item.type ?? 'ощущение')}${turnsText === null ? '' : ` на ${turnsText} об.`}`
    })
    const legacyNotes = typeof old.notes === 'string' ? old.notes : ''
    const fragments = [legacyNotes]
    if (legacyNumber(old.distance, 0, 500) !== null) fragments.push(`Историческая оценка длины: ${old.distance} м (не позиция на карте).`)
    if (legacyNumber(old.depth, 0, 10_000) !== null) fragments.push(`Историческая глубина: ${old.depth} м (источник не указан; в поле глубины не перенесена).`)
    if (observations.length) fragments.push(`Старые отметки: ${observations.join('; ')}${oldEvents.length > 100 ? `; ещё ${oldEvents.length - 100} в исходной копии` : ''}.`)
    const rawFall = old.fallInterrupted === true ? null : legacyNumber(old.fall, 0, 600)
    casts.push({
      id: crypto.randomUUID(), sessionId: session.id,
      createdAt: legacyTimestamp(old.createdAt, importedAt), updatedAt: importedAt,
      directionDeg: angle, station,
      calibration: { metersPerTurn: oldPickup, source: 'estimate', measuredLengthM: null, measuredTurns: null },
      target: null, fallSeconds: rawFall, fallInterrupted: old.fallInterrupted === true,
      totalTurns: turns, completeRetrieve: old.complete === true && old.method === 'reel' && turns > 0,
      marks: [], depth: null, note: fragments.filter(Boolean).join('\n').slice(0, 20_000), favorite: false,
    })
  }
  const data: FieldData = {
    ...structuredClone(emptyFieldData), sessions: [session], casts, activeSessionId: session.id,
    legacyBackups: [{ id: crypto.randomUUID(), name: title, importedAt, source }],
  }
  return {
    data: validateFieldData(data),
    warning: `Старая версия 2: перенесено ${casts.length} забросов${skipped ? `, ${skipped} остались только в исходной копии` : ''}. Старые отметки, неподтверждённая глубина, статус, снасть и черновик сохранены в исходном файле; часть отметок показана текстом в заметках. Координаты без подтверждённой привязки не добавлены.`,
  }
}

export function parseImportJson(text: string): ImportPreview {
  const input: unknown = JSON.parse(text)
  if (input && typeof input === 'object' && 'app' in input && input.app === 'marker-mobile' &&
    'schemaVersion' in input && input.schemaVersion === 2) {
    return parseLegacyV2(input as Record<string, unknown>, text)
  }
  // The standalone HTML embeds FieldData directly; JSON downloads use a wrapper.
  if (input && typeof input === 'object' && 'version' in input && input.version === 1 && 'sessions' in input) {
    return { data: validateFieldData(input), warning: null }
  }
  return { data: parseBackup(text), warning: null }
}

export function parsePortableBackupHtml(html: string): ImportPreview {
  // Read only the generated data element. Imported HTML is never inserted or run.
  const json = html.match(/<script id="embedded-state" type="application\/json">([\s\S]*?)<\/script>/i)?.[1]?.trim()
  if (!json) throw new Error('В HTML нет данных автономной копии Маркера.')
  return parseImportJson(json)
}

export function backupJson(data: FieldData): string {
  const backup: Backup = { kind: 'marker-backup', version: 1, exportedAt: new Date().toISOString(), data: validateFieldData(data) }
  return JSON.stringify(backup, null, 2)
}

export function mergeBackup(current: FieldData, incoming: FieldData): FieldData {
  const sessionIds = new Map(incoming.sessions.map((session) => [session.id, crypto.randomUUID()]))
  const sessions: Session[] = incoming.sessions.map((session) => ({ ...session, id: sessionIds.get(session.id)! }))
  const casts: Cast[] = incoming.casts.map((cast) => ({
    ...cast,
    id: crypto.randomUUID(),
    sessionId: sessionIds.get(cast.sessionId)!,
    marks: cast.marks.map((mark) => ({ ...mark, id: crypto.randomUUID() })),
  }))
  const charts: ChartDataset[] = incoming.charts.map((chart) => ({ ...chart, id: crypto.randomUUID() }))
  const incomingDraft = incoming.draft && !current.draft ? {
    ...incoming.draft,
    id: crypto.randomUUID(),
    sessionId: sessionIds.get(incoming.draft.sessionId)!,
    marks: incoming.draft.marks.map((mark) => ({ ...mark, id: crypto.randomUUID() })),
    ...(incoming.draft.stage === 'falling' ? {
      stage: 'interrupted' as const, startedAt: null, fallSeconds: null, fallInterrupted: true,
    } : {}),
  } : null
  return validateFieldData({
    ...current,
    sessions: [...current.sessions, ...sessions],
    casts: [...current.casts, ...casts],
    charts: [...current.charts, ...charts],
    legacyBackups: [...(current.legacyBackups ?? []), ...(incoming.legacyBackups ?? []).map((backup) => ({ ...backup, id: crypto.randomUUID() }))],
    activeSessionId: incomingDraft?.sessionId ?? current.activeSessionId ?? sessions[0]?.id ?? null,
    // Active work and cloud ownership belong only to this device/account.
    draft: current.draft ?? incomingDraft,
    sync: current.sync,
  })
}

export function removeCast(data: FieldData, id: string): FieldData {
  if (data.draft?.id === id) throw new Error('Сначала завершите активный промер.')
  const cast = data.casts.find((item) => item.id === id)
  if (!cast) return data
  const synced = Boolean(data.sync.casts[id])
  return {
    ...data,
    casts: data.casts.filter((item) => item.id !== id),
    sync: {
      ...data.sync,
      // Keep the cloud revision until the tombstone is acknowledged.
      casts: data.sync.casts,
      deletedCasts: synced && !data.sync.deletedCasts.some((item) => item.id === id)
        ? [...data.sync.deletedCasts, { id, sessionId: cast.sessionId }]
        : data.sync.deletedCasts,
    },
  }
}

export function removeSession(data: FieldData, id: string): FieldData {
  if (data.draft?.sessionId === id) throw new Error('Сначала завершите активный промер в этой сессии.')
  const session = data.sessions.find((item) => item.id === id)
  if (!session) return data
  const removedCasts = data.casts.filter((cast) => cast.sessionId === id)
  const removedCastIds = new Set(removedCasts.map((cast) => cast.id))
  const deletedCasts = [...data.sync.deletedCasts]
  for (const cast of removedCasts) {
    if (data.sync.casts[cast.id] && !deletedCasts.some((item) => item.id === cast.id)) {
      deletedCasts.push({ id: cast.id, sessionId: id })
    }
  }
  const syncedSession = Boolean(data.sync.sessions[id])
  return {
    ...data,
    sessions: data.sessions.filter((item) => item.id !== id),
    casts: data.casts.filter((cast) => !removedCastIds.has(cast.id)),
    activeSessionId: data.activeSessionId === id ? data.sessions.find((item) => item.id !== id)?.id ?? null : data.activeSessionId,
    sync: {
      ...data.sync,
      // Deletion requests need the last confirmed revision for compare-and-swap.
      sessions: data.sync.sessions,
      casts: data.sync.casts,
      deletedSessions: syncedSession && !data.sync.deletedSessions.includes(id)
        ? [...data.sync.deletedSessions, id] : data.sync.deletedSessions,
      deletedCasts,
    },
  }
}

function escapeCsv(value: string, text = true): string {
  const safe = text && /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function castsCsv(data: FieldData): string {
  const sessionNames = new Map(data.sessions.map((session) => [session.id, session.name]))
  const rows = [['Сессия', 'ID заброса', 'Время', 'Направление °', 'Обороты ручки', 'Выборка м/оборот', 'Выбранная леска м', 'Подмотка полная', 'Падение с', 'Глубина м', 'Источник глубины', 'Избранное', 'Отметки', 'Заметка']]
  for (const cast of data.casts) {
    rows.push([
      sessionNames.get(cast.sessionId) ?? '', cast.id, cast.createdAt,
      String(cast.directionDeg), String(cast.totalTurns), String(cast.calibration.metersPerTurn),
      cast.completeRetrieve ? String(cast.totalTurns * cast.calibration.metersPerTurn) : '',
      cast.completeRetrieve ? 'да' : 'нет', cast.fallSeconds === null ? '' : String(cast.fallSeconds),
      cast.depth?.meters === undefined ? '' : String(cast.depth.meters), cast.depth?.source ?? '',
      cast.favorite ? 'да' : 'нет',
      cast.marks.map((mark) => `${mark.turns}: ${mark.kind}${mark.note ? ` (${mark.note})` : ''}`).join('; '),
      cast.note,
    ])
  }
  const numberColumns = new Set([3, 4, 5, 6, 8, 9])
  return '\uFEFF' + rows.map((row, rowIndex) => row.map((value, columnIndex) =>
    escapeCsv(value, rowIndex === 0 || !numberColumns.has(columnIndex))).join(',')).join('\r\n')
}

export function parseChartGeoJson(text: string, metadata: { name: string; source: string; verticalDatum: string }): ChartDataset {
  const input: unknown = JSON.parse(text)
  if (!input || typeof input !== 'object' || !('type' in input) || input.type !== 'FeatureCollection' ||
    !('features' in input) || !Array.isArray(input.features)) {
    throw new Error('Нужен GeoJSON FeatureCollection с точками глубины.')
  }
  if (!metadata.name.trim() || !metadata.source.trim() || !metadata.verticalDatum.trim()) {
    throw new Error('Укажите название, источник и вертикальный датум карты глубин.')
  }
  const features = input.features
  if (features.length === 0 || features.length > 100_000) throw new Error('В файле должно быть от 1 до 100 000 точек.')
  const points = features.map((feature: unknown, index: number) => {
    if (!feature || typeof feature !== 'object' || !('geometry' in feature) || !('properties' in feature)) {
      throw new Error(`Объект ${index + 1}: нет geometry/properties.`)
    }
    const geometry = feature.geometry
    const properties = feature.properties
    if (!geometry || typeof geometry !== 'object' || !('type' in geometry) || geometry.type !== 'Point' ||
      !('coordinates' in geometry) || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 ||
      !properties || typeof properties !== 'object') {
      throw new Error(`Объект ${index + 1}: нужна точка с глубиной.`)
    }
    const [lon, lat] = geometry.coordinates
    const rawDepth = 'depthM' in properties ? properties.depthM
      : 'depth_m' in properties ? properties.depth_m
        : 'depth' in properties ? properties.depth : undefined
    if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof rawDepth !== 'number' || !Number.isFinite(rawDepth) || rawDepth < 0 || rawDepth > 10_000) {
      throw new Error(`Объект ${index + 1}: неверные координаты или числовая глубина в метрах.`)
    }
    return { position: { lon, lat }, depthM: rawDepth }
  })
  return {
    id: crypto.randomUUID(), name: metadata.name.trim(), source: metadata.source.trim(),
    verticalDatum: metadata.verticalDatum.trim(), importedAt: new Date().toISOString(), points,
  }
}
