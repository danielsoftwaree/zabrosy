import {
  defaultCalibration,
  type BottomKind,
  type Calibration,
  type Cast,
  type Coordinate,
  type Draft,
  type Session,
  type Station,
} from '../../shared/model'
import { bearingDegrees } from '../../shared/lib/geo'

export function decimal(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

export function direction(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180
}

export function sameFrame(left: Station, right: Station): boolean {
  return left.referenceBearingDeg === right.referenceBearingDeg
    && left.position?.lat === right.position?.lat
    && left.position?.lon === right.position?.lon
}

export function targetDirection(session: Session, target: Coordinate | null): number | null {
  const { position, referenceBearingDeg } = session.station
  if (!position || referenceBearingDeg === null || !target) return null
  return direction(bearingDegrees(position, target) - referenceBearingDeg)
}

export function newSession(now = new Date()): Session {
  const timestamp = now.toISOString()
  return {
    id: crypto.randomUUID(), name: `Сессия ${now.toLocaleDateString('ru-RU')}`,
    createdAt: timestamp, updatedAt: timestamp,
    station: { position: null, accuracyM: null, referenceBearingDeg: null },
    calibration: { ...defaultCalibration }, plannedLineM: 30,
  }
}

export function calibrationFromInput(length: string, turns: string, perTurn: string): Calibration {
  if (length.trim() || turns.trim()) {
    const measuredLengthM = decimal(length)
    const measuredTurns = decimal(turns)
    if (measuredLengthM === null || measuredTurns === null || measuredLengthM <= 0 || measuredTurns <= 0) {
      throw new Error('Укажи измеренную длину и число оборотов больше нуля.')
    }
    const metersPerTurn = measuredLengthM / measuredTurns
    if (metersPerTurn < .05 || metersPerTurn > 3) throw new Error('Выборка должна быть от 5 см до 3 м за оборот.')
    return { metersPerTurn, source: 'measured', measuredLengthM, measuredTurns }
  }
  const metersPerTurn = decimal(perTurn)
  if (metersPerTurn === null || metersPerTurn < .05 || metersPerTurn > 3) throw new Error('Выборка должна быть от 5 см до 3 м за оборот.')
  return { metersPerTurn, source: 'estimate', measuredLengthM: null, measuredTurns: null }
}

export function newDraft(session: Session, angle: number, target: Coordinate | null, now = new Date()): Draft {
  if (!Number.isFinite(angle)) throw new Error('Угол не задан.')
  const timestamp = now.toISOString()
  return {
    id: crypto.randomUUID(), sessionId: session.id, createdAt: timestamp,
    directionDeg: direction(angle), station: structuredClone(session.station),
    calibration: structuredClone(session.calibration), plannedLineM: session.plannedLineM ?? 30, target,
    fallSeconds: null, fallInterrupted: false, totalTurns: 0,
    completeRetrieve: false, marks: [], depth: null, note: '', favorite: false,
    stage: 'armed', startedAt: null,
  }
}

export function repeatDraft(cast: Cast, session: Session): Draft {
  if (cast.sessionId !== session.id || !sameFrame(cast.station, session.station)) {
    throw new Error('Повторить заброс можно только с той же станции и тем же ориентиром.')
  }
  return { ...newDraft(session, cast.directionDeg, cast.target ? { ...cast.target } : null), plannedLineM: cast.plannedLineM ?? session.plannedLineM ?? 30 }
}

export function water(draft: Draft, startedAt: number): Draft {
  if (draft.stage !== 'armed') return draft
  return { ...draft, stage: 'falling', startedAt, fallSeconds: null, fallInterrupted: false }
}

export function bottom(draft: Draft, stoppedAt: number): Draft {
  if (draft.stage !== 'falling') return draft
  const elapsed = draft.startedAt === null ? NaN : (stoppedAt - draft.startedAt) / 1000
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 600) return interrupt(draft)
  return { ...draft, stage: 'retrieve', startedAt: null, fallSeconds: Math.round(elapsed * 100) / 100 }
}

export function interrupt(draft: Draft): Draft {
  return draft.stage === 'falling'
    ? { ...draft, stage: 'interrupted', startedAt: null, fallSeconds: null, fallInterrupted: true }
    : draft
}

export function skipFall(draft: Draft): Draft {
  if (draft.stage !== 'armed' && draft.stage !== 'interrupted') return draft
  return { ...draft, stage: 'retrieve', startedAt: null, fallSeconds: null }
}

export function setTurns(draft: Draft, turns: number): Draft {
  if (draft.stage !== 'retrieve') return draft
  if (!Number.isFinite(turns) || turns < 0 || turns > 10000 || turns < Math.max(0, ...draft.marks.map((mark) => mark.turns))) {
    throw new Error('Число оборотов должно быть от 0 до 10 000 и не меньше последней отметки.')
  }
  return { ...draft, totalTurns: turns }
}

export function addMark(draft: Draft, kind: BottomKind): Draft {
  if (draft.stage !== 'retrieve') return draft
  return { ...draft, marks: [...draft.marks, { id: crypto.randomUUID(), kind, turns: draft.totalTurns, note: '' }] }
}

export function removeMark(draft: Draft, id: string): Draft {
  if (draft.stage !== 'retrieve') return draft
  return { ...draft, marks: draft.marks.filter((mark) => mark.id !== id) }
}

export function changeMarkTurns(draft: Draft, id: string, turns: number): Draft {
  if (draft.stage !== 'retrieve') return draft
  if (!Number.isFinite(turns) || turns < 0 || turns > draft.totalTurns) throw new Error('Позиция отметки должна быть в пределах подмотки.')
  return { ...draft, marks: draft.marks.map((mark) => mark.id === id ? { ...mark, turns } : mark) }
}

export function changeMarkNote(draft: Draft, id: string, note: string): Draft {
  if (draft.stage !== 'retrieve') return draft
  if (note.length > 10_000) throw new Error('Заметка к отметке слишком длинная.')
  return { ...draft, marks: draft.marks.map((mark) => mark.id === id ? { ...mark, note } : mark) }
}

export function toCast(draft: Draft, completeRetrieve: boolean, depthMeters: number | null, note: string, depthAtTarget = false, now = new Date()): Cast {
  if (draft.stage !== 'review') throw new Error('Сначала проверь итог заброса.')
  if (completeRetrieve && draft.totalTurns <= 0) throw new Error('Для полной подмотки укажи обороты больше нуля.')
  if (depthMeters !== null && (!Number.isFinite(depthMeters) || depthMeters < 0 || depthMeters > 100)) {
    throw new Error('Глубина должна быть от 0 до 100 м.')
  }
  const { stage: _stage, startedAt: _startedAt, ...cast } = draft
  void _stage; void _startedAt
  const timestamp = now.toISOString()
  return {
    ...cast, updatedAt: timestamp, completeRetrieve, note: note.trim(),
    depth: depthMeters === null ? null : { meters: depthMeters, source: 'manual', observedAt: timestamp },
    depthPosition: depthMeters !== null && depthAtTarget && draft.target ? { ...draft.target } : null,
  }
}

export function lineLength(cast: Cast): number | null {
  return cast.completeRetrieve ? cast.totalTurns * cast.calibration.metersPerTurn : null
}

export function markLineLength(cast: Cast, turns: number): number | null {
  const total = lineLength(cast)
  return total === null || turns > cast.totalTurns ? null : (cast.totalTurns - turns) * cast.calibration.metersPerTurn
}
