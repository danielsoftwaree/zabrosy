import { create } from 'zustand'
import type { Coordinate } from '../../shared/model'
import type { PhotoPoint } from './photo-geometry'

export type PhotoFrame = { url: string; width: number; height: number }

// UI-only registration: photos and control points are never uploaded or mistaken for survey data.
export const useMapTools = create<{
  mode: 'distance' | 'photo' | null
  points: Coordinate[]
  anchors: Coordinate[]
  photoOrigin: Coordinate | null
  photo: PhotoFrame | null
  photoPoints: PhotoPoint[]
  photoPick: PhotoPoint | null
  dataset: string
  start(mode: 'distance' | 'photo', origin: Coordinate | null): void
  add(point: Coordinate): void
  undo(): void
  finish(): void
  clear(): void
  setPhoto(photo: PhotoFrame | null): void
  setPhotoPoints(points: PhotoPoint[]): void
  setPhotoPick(point: PhotoPoint | null): void
  selectDataset(id: string): void
}>((set) => ({
  mode: null, points: [], anchors: [], photoOrigin: null, photo: null, photoPoints: [], photoPick: null, dataset: 'own',
  start: (mode, origin) => set({ mode, points: [], anchors: [], photoOrigin: mode === 'photo' ? origin : null, photo: null, photoPoints: [], photoPick: null }),
  add: point => set(state => ({ points: state.points.length < (state.mode === 'photo' ? 4 : 2) ? [...state.points, point] : state.points })),
  undo: () => set(state => ({ points: state.points.slice(0, -1) })),
  finish: () => set(state => ({ mode: null, ...(state.mode === 'photo' && state.points.length === 4 ? { anchors: state.points } : {}) })),
  clear: () => set({ mode: null, points: [], anchors: [], photoOrigin: null, photo: null, photoPoints: [], photoPick: null }),
  setPhoto: photo => set({ photo, photoPoints: [], photoPick: null }),
  setPhotoPoints: photoPoints => set({ photoPoints, photoPick: null }),
  setPhotoPick: photoPick => set({ photoPick }),
  selectDataset: dataset => set({ dataset }),
}))
