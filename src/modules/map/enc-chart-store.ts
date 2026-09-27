import { create } from 'zustand'
import type { EncChart } from './enc-chart'

export const useEncChart = create<{ chart: EncChart | null; setChart(chart: EncChart | null): void }>(set => ({
  chart: null,
  setChart: chart => set({ chart }),
}))
