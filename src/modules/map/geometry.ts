import type { Coordinate } from '../../shared/model'

import { fromLocalMeters } from '../../shared/lib/geo'
export { distanceMeters, bearingDegrees, localMeters, fromLocalMeters } from '../../shared/lib/geo'
export const CEGIELINKA: Coordinate = { lat: 53.38668567559915, lon: 14.619047606247443 }

export type MapBounds = { west: number; south: number; east: number; north: number }
export function mapBounds(center: Coordinate, halfSpanM: number): MapBounds {
  const sw = fromLocalMeters(center, -halfSpanM, -halfSpanM)
  const ne = fromLocalMeters(center, halfSpanM, halfSpanM)
  return { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat }
}

export function coordinateAt(bounds: MapBounds, x: number, y: number): Coordinate {
  return { lon: bounds.west + x * (bounds.east - bounds.west), lat: bounds.north - y * (bounds.north - bounds.south) }
}

export function locationPercent(bounds: MapBounds, point: Coordinate) {
  return { x: ((point.lon - bounds.west) / (bounds.east - bounds.west)) * 100, y: ((bounds.north - point.lat) / (bounds.north - bounds.south)) * 100 }
}

export function orthoUrl(bounds: MapBounds, resolution: 'HighResolution' | 'StandardResolution') {
  const params = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: 'Raster', STYLES: '',
    SRS: 'EPSG:4326', BBOX: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    WIDTH: '1200', HEIGHT: '1200', FORMAT: 'image/jpeg', TRANSPARENT: 'FALSE',
  })
  return `https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/${resolution}?${params}`
}
