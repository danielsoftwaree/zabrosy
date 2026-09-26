import { create } from 'zustand'

export type FieldView = 'sector' | 'aerial' | 'bottom' | 'camera'
export type FieldDrawer = 'survey' | 'point' | 'coordinates'

type FieldUiState = {
  view: FieldView
  drawer: FieldDrawer
  expanded: boolean
  setView: (view: FieldView) => void
  setDrawer: (drawer: FieldDrawer) => void
  setExpanded: (expanded: boolean) => void
}

export const useFieldUi = create<FieldUiState>((set) => ({
  view: 'sector',
  drawer: 'survey',
  expanded: false,
  setView: (view) => set({ view, drawer: 'survey', expanded: false }),
  setDrawer: (drawer) => set({ drawer, expanded: drawer !== 'survey' }),
  setExpanded: (expanded) => set({ expanded }),
}))
