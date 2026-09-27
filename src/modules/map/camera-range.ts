export type PitchSample = { at: number; depressionDeg: number }

export type StablePitch =
  | { ready: true; depressionDeg: number; spreadDeg: number }
  | { ready: false; reason: 'waiting' | 'stale' | 'moving' }

/** The rear camera points along device -z; screen rotation does not change that axis. */
export function rearCameraDepression(beta: number | null, gamma: number | null): number | null {
  if (beta === null || gamma === null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return null
  const verticalDown = Math.cos(beta * Math.PI / 180) * Math.cos(gamma * Math.PI / 180)
  return Math.asin(Math.max(-1, Math.min(1, verticalDown))) * 180 / Math.PI
}

export function stablePitch(samples: PitchSample[], now: number): StablePitch {
  const recent = samples.filter(sample => now - sample.at <= 1200 && sample.at <= now)
  if (!recent.length || now - recent[recent.length - 1].at > 500) return { ready: false, reason: 'stale' }
  if (recent.length < 5 || recent[recent.length - 1].at - recent[0].at < 400) return { ready: false, reason: 'waiting' }
  const angles = recent.map(sample => sample.depressionDeg).sort((a, b) => a - b)
  const spreadDeg = angles[angles.length - 1] - angles[0]
  if (spreadDeg > 1.2) return { ready: false, reason: 'moving' }
  return { ready: true, depressionDeg: angles[Math.floor(angles.length / 2)], spreadDeg }
}

export type Calibration = {
  method: 'horizon' | 'known-distance'
  offsetDeg: number
  at: number
  heightM: number
  knownDistanceM?: number
}

export function calibratePitch(rawDepressionDeg: number, heightM: number, method: Calibration['method'], now: number, knownDistanceM?: number): Calibration | null {
  if (!Number.isFinite(rawDepressionDeg) || !Number.isFinite(heightM) || heightM <= 0) return null
  if (method === 'known-distance' && (knownDistanceM === undefined || !Number.isFinite(knownDistanceM) || knownDistanceM <= 0)) return null
  const expectedDeg = method === 'horizon' ? 0 : Math.atan(heightM / knownDistanceM!) * 180 / Math.PI
  return { method, offsetDeg: rawDepressionDeg - expectedDeg, at: now, heightM, ...(method === 'known-distance' ? { knownDistanceM } : {}) }
}

export type RangeResult =
  | { valid: true; distanceM: number; lowerM: number; upperM: number; depressionDeg: number; angleToleranceDeg: number; heightToleranceM: number }
  | { valid: false; reason: 'invalid' | 'above-water' | 'near-horizon' | 'too-steep' }

/** Sensitivity interval, not a statistical confidence interval or device accuracy claim. */
export function estimateWaterRange(input: {
  rawDepressionDeg: number
  spreadDeg: number
  heightM: number
  heightToleranceM: number
  calibration: Calibration
}): RangeResult {
  const { rawDepressionDeg, spreadDeg, heightM, heightToleranceM, calibration } = input
  if (![rawDepressionDeg, spreadDeg, heightM, heightToleranceM, calibration.offsetDeg].every(Number.isFinite)
    || heightM <= 0 || heightToleranceM < 0 || heightToleranceM >= heightM || spreadDeg < 0) return { valid: false, reason: 'invalid' }
  const depressionDeg = rawDepressionDeg - calibration.offsetDeg
  if (depressionDeg < 0) return { valid: false, reason: 'above-water' }
  // Assumed ±2° aiming/calibration error plus observed movement; not a sensor specification.
  const angleToleranceDeg = 2 + spreadDeg / 2
  const nearAngle = depressionDeg - angleToleranceDeg
  if (nearAngle <= 1) return { valid: false, reason: 'near-horizon' }
  if (depressionDeg >= 85) return { valid: false, reason: 'too-steep' }
  const rad = Math.PI / 180
  const distanceM = heightM / Math.tan(depressionDeg * rad)
  const lowerM = (heightM - heightToleranceM) / Math.tan((depressionDeg + angleToleranceDeg) * rad)
  const upperM = (heightM + heightToleranceM) / Math.tan(nearAngle * rad)
  if (![distanceM, lowerM, upperM].every(Number.isFinite) || lowerM <= 0 || upperM / lowerM > 3) return { valid: false, reason: 'near-horizon' }
  return { valid: true, distanceM, lowerM, upperM, depressionDeg, angleToleranceDeg, heightToleranceM }
}
