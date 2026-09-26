import { z } from 'zod'
import type { FieldData } from '../model'

const id = z.string().uuid()
const date = z.string().datetime({ offset: true })
const coordinateSchema = z.strictObject({ lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180) })
const stationSchema = z.strictObject({
  position: coordinateSchema.nullable(),
  accuracyM: z.number().finite().nonnegative().nullable(),
  referenceBearingDeg: z.number().finite().min(0).max(360).nullable(),
})
const calibrationSchema = z.strictObject({
  metersPerTurn: z.number().finite().min(0.05).max(3),
  source: z.enum(['estimate', 'measured']),
  measuredLengthM: z.number().finite().positive().nullable(),
  measuredTurns: z.number().finite().positive().nullable(),
})
const markSchema = z.strictObject({
  id,
  turns: z.number().finite().min(0).max(10_000),
  kind: z.enum(['silt', 'sand', 'gravel', 'shell', 'weed', 'edge']),
  note: z.string().max(10_000),
})
const depthSchema = z.strictObject({
  meters: z.number().finite().min(0).max(10_000),
  source: z.enum(['manual', 'marker-float', 'chart']),
  observedAt: date,
})

export const sessionSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(200),
  createdAt: date,
  updatedAt: date,
  station: stationSchema,
  target: coordinateSchema.nullable().optional(),
  calibration: calibrationSchema,
  plannedLineM: z.number().finite().min(1).max(180).optional(),
})

const baseCastSchema = z.strictObject({
  id,
  sessionId: id,
  createdAt: date,
  updatedAt: date,
  directionDeg: z.number().finite().min(-180).max(180),
  station: stationSchema,
  calibration: calibrationSchema,
  plannedLineM: z.number().finite().min(1).max(180).optional(),
  target: coordinateSchema.nullable(),
  depthPosition: coordinateSchema.nullable().optional(),
  fallSeconds: z.number().finite().min(0).max(600).nullable(),
  fallInterrupted: z.boolean(),
  totalTurns: z.number().finite().min(0).max(10_000),
  completeRetrieve: z.boolean(),
  marks: z.array(markSchema).max(10_000),
  depth: depthSchema.nullable(),
  note: z.string().max(20_000),
  favorite: z.boolean(),
})

function checkMeasurements(record: { totalTurns: number; completeRetrieve: boolean; marks: { turns: number }[]; fallSeconds: number | null; fallInterrupted: boolean }, context: z.RefinementCtx) {
  if (record.completeRetrieve && record.totalTurns <= 0) context.addIssue({ code: 'custom', message: 'Для полной подмотки нужно число оборотов больше нуля', path: ['totalTurns'] })
  record.marks.forEach((mark, i) => {
    if (mark.turns > record.totalTurns) context.addIssue({ code: 'custom', message: 'Отметка находится за пределами подмотки', path: ['marks', i, 'turns'] })
  })
  if (record.fallInterrupted && record.fallSeconds !== null) context.addIssue({ code: 'custom', message: 'Прерванный отсчёт не является замером времени', path: ['fallSeconds'] })
}

export const castSchema = baseCastSchema.superRefine(checkMeasurements)

const draftSchema = baseCastSchema.omit({ updatedAt: true }).safeExtend({
  stage: z.enum(['armed', 'falling', 'interrupted', 'retrieve', 'review']),
  startedAt: z.number().finite().nonnegative().nullable(),
}).superRefine(checkMeasurements)
export const chartSchema = z.strictObject({
  id,
  name: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(500),
  verticalDatum: z.string().trim().min(1).max(200),
  importedAt: date,
  points: z.array(z.strictObject({ position: coordinateSchema, depthM: z.number().finite().min(0).max(10_000) })).max(100_000),
})
const syncRecordSchema = z.strictObject({ revision: z.number().int().nonnegative(), syncedUpdatedAt: date.or(z.literal('')) })

export const fieldDataSchema = z.strictObject({
  version: z.literal(1),
  sessions: z.array(sessionSchema),
  casts: z.array(castSchema),
  activeSessionId: id.nullable(),
  draft: draftSchema.nullable(),
  charts: z.array(chartSchema),
  legacyBackups: z.array(z.strictObject({
    id, name: z.string().trim().min(1).max(200), importedAt: date,
    source: z.string().min(1).max(100_000_000),
  })).optional(),
  sync: z.strictObject({
    ownerId: id.nullable(),
    enabled: z.boolean().optional(),
    sessions: z.record(id, syncRecordSchema),
    casts: z.record(id, syncRecordSchema),
    deletedSessions: z.array(id),
    deletedCasts: z.array(z.strictObject({ id, sessionId: id })),
  }),
}).superRefine((data, context) => {
  const sessions = new Set(data.sessions.map((session) => session.id))
  const casts = new Set(data.casts.map((cast) => cast.id))
  if (sessions.size !== data.sessions.length) context.addIssue({ code: 'custom', message: 'Duplicate session ID', path: ['sessions'] })
  if (casts.size !== data.casts.length) context.addIssue({ code: 'custom', message: 'Duplicate cast ID', path: ['casts'] })
  if (data.activeSessionId && !sessions.has(data.activeSessionId)) context.addIssue({ code: 'custom', message: 'Active session is missing', path: ['activeSessionId'] })
  if (data.draft && !sessions.has(data.draft.sessionId)) context.addIssue({ code: 'custom', message: 'Draft session is missing', path: ['draft'] })
  data.casts.forEach((cast, index) => {
    if (!sessions.has(cast.sessionId)) context.addIssue({ code: 'custom', message: 'Cast session is missing', path: ['casts', index, 'sessionId'] })
    if (new Set(cast.marks.map((mark) => mark.id)).size !== cast.marks.length) context.addIssue({ code: 'custom', message: 'Duplicate mark ID', path: ['casts', index, 'marks'] })
  })
  if (new Set(data.charts.map((chart) => chart.id)).size !== data.charts.length) context.addIssue({ code: 'custom', message: 'Duplicate chart ID', path: ['charts'] })
})

export function validateFieldData(value: unknown): FieldData {
  return fieldDataSchema.parse(value) as FieldData
}
