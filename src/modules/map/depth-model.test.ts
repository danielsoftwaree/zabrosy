import { expect, it } from 'vitest'
import { convexHull, estimateDepth } from './depth-model'
it('interpolates only supported areas inside non-collinear measured points', () => {
  const points = [{ east: 0, north: 0, meters: 2 }, { east: 10, north: 0, meters: 4 }, { east: 0, north: 10, meters: 6 }]
  const hull = convexHull(points)
  expect(estimateDepth(points, hull, 0, 0, 20)).toBe(2)
  const estimate = estimateDepth(points, hull, 3, 3, 20)!
  expect(estimate).toBeGreaterThan(2); expect(estimate).toBeLessThan(6)
  expect(estimateDepth(points, hull, 8, 8, 20)).toBeNull()
  expect(estimateDepth(points, hull, 3, 3, 2)).toBeNull()
  expect(convexHull([{ east: 0, north: 0, meters: 2 }, { east: 10, north: 0, meters: 3 }, { east: 20, north: 0, meters: 5 }])).toEqual([])
})
