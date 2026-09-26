import type { Coordinate } from '../model'
const EARTH_RADIUS_M = 6_371_008.8

export function distanceMeters(a: Coordinate, b: Coordinate) {
  const toRadians = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRadians
  const dLon = (b.lon - a.lon) * toRadians
  const lat1 = a.lat * toRadians
  const lat2 = b.lat * toRadians
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bearingDegrees(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180
  const lat1 = a.lat * rad
  const lat2 = b.lat * rad
  const dLon = (b.lon - a.lon) * rad
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360
}

export function localMeters(origin: Coordinate, point: Coordinate) {
  const rad = Math.PI / 180
  return {
    east: (point.lon - origin.lon) * rad * EARTH_RADIUS_M * Math.cos(origin.lat * rad),
    north: (point.lat - origin.lat) * rad * EARTH_RADIUS_M,
  }
}

export function fromLocalMeters(origin: Coordinate, east: number, north: number): Coordinate {
  const deg = 180 / Math.PI
  return {
    lat: origin.lat + (north / EARTH_RADIUS_M) * deg,
    lon: origin.lon + (east / (EARTH_RADIUS_M * Math.cos(origin.lat / deg))) * deg,
  }
}
