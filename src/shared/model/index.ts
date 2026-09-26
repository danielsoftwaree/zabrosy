export type Coordinate = { lat: number; lon: number }
export type Station = { position: Coordinate | null; accuracyM: number | null; referenceBearingDeg: number | null }
export type Calibration = { metersPerTurn: number; source: 'estimate' | 'measured'; measuredLengthM: number | null; measuredTurns: number | null }
export type BottomKind = 'silt' | 'sand' | 'gravel' | 'shell' | 'weed' | 'edge'
export type BottomMark = { id: string; turns: number; kind: BottomKind; note: string }
export type Depth = { meters: number; source: 'manual' | 'marker-float' | 'chart'; observedAt: string }
export type Session = { id: string; name: string; createdAt: string; updatedAt: string; station: Station; calibration: Calibration; target?: Coordinate | null; plannedLineM?: number }
export type Cast = {
  id: string; sessionId: string; createdAt: string; updatedAt: string;
  directionDeg: number; station: Station; calibration: Calibration; plannedLineM?: number;
  target: Coordinate | null; fallSeconds: number | null; fallInterrupted: boolean;
  totalTurns: number; completeRetrieve: boolean; marks: BottomMark[];
  depth: Depth | null; depthPosition?: Coordinate | null; note: string; favorite: boolean;
}
export type Draft = Omit<Cast, 'updatedAt'> & { stage: 'armed' | 'falling' | 'interrupted' | 'retrieve' | 'review'; startedAt: number | null }
export type ChartPoint = { position: Coordinate; depthM: number }
export type ChartDataset = { id: string; name: string; source: string; verticalDatum: string; importedAt: string; points: ChartPoint[] }
export type SyncRecord = { revision: number; syncedUpdatedAt: string }
export type FieldData = {
  version: 1; sessions: Session[]; casts: Cast[]; activeSessionId: string | null; draft: Draft | null;
  charts: ChartDataset[];
  legacyBackups?: { id: string; name: string; importedAt: string; source: string }[];
  sync: { enabled?: boolean; ownerId: string | null; sessions: Record<string, SyncRecord>; casts: Record<string, SyncRecord>; deletedSessions: string[]; deletedCasts: { id: string; sessionId: string }[] }
}
export const defaultCalibration: Calibration = { metersPerTurn: 0.8, source: 'estimate', measuredLengthM: null, measuredTurns: null }
export const emptyFieldData: FieldData = { version: 1, sessions: [], casts: [], activeSessionId: null, draft: null, charts: [], sync: { ownerId: null, sessions: {}, casts: {}, deletedSessions: [], deletedCasts: [] } }
export const bottomLabels: Record<BottomKind, string> = { silt: 'Ил', sand: 'Песок', gravel: 'Камни', shell: 'Ракушка', weed: 'Трава', edge: 'Бровка' }
