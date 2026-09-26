import { expect, it } from 'vitest'
import { cameraPlaneHeading, relativeAngle } from './sensors'
it('uses the camera axis and reverses alpha rotation instead of calling alpha a compass', () => {
  expect(cameraPlaneHeading(0, 90, 0)).toBeCloseTo(0)
  expect(cameraPlaneHeading(90, 90, 0)).toBeCloseTo(270)
  expect(relativeAngle(cameraPlaneHeading(10, 90, 0)!, cameraPlaneHeading(0, 90, 0)!)).toBeCloseTo(-10)
  expect(cameraPlaneHeading(0, 0, 0)).toBeNull()
  expect(cameraPlaneHeading(null, 90, 0)).toBeNull()
})
