import { describe, expect, it } from 'vitest'
import { CEGIELINKA, bearingDegrees, coordinateAt, distanceMeters, fromLocalMeters, locationPercent, mapBounds, orthoUrl } from './geometry'

describe('map geometry', () => {
  it('keeps the selected map point and measured distance in the same coordinate frame', () => {
    const east100 = fromLocalMeters(CEGIELINKA, 100, 0)
    expect(distanceMeters(CEGIELINKA, east100)).toBeCloseTo(100, 1)
    expect(bearingDegrees(CEGIELINKA, east100)).toBeCloseTo(90, 1)
    const bounds = mapBounds(CEGIELINKA, 200)
    expect(locationPercent(bounds, east100).x).toBeCloseTo(75, 1)
    expect(coordinateAt(bounds, .75, .5).lon).toBeCloseTo(east100.lon, 5)
  })

  it('requests the official WMS with the advertised EPSG:4326 and lon/lat bounds', () => {
    const bounds = mapBounds(CEGIELINKA, 140)
    const url = new URL(orthoUrl(bounds, 'HighResolution'))
    expect(url.hostname).toBe('mapy.geoportal.gov.pl')
    expect(url.searchParams.get('SRS')).toBe('EPSG:4326')
    expect(url.searchParams.get('LAYERS')).toBe('Raster')
    expect(url.searchParams.get('BBOX')).toBe(`${bounds.west},${bounds.south},${bounds.east},${bounds.north}`)
  })
})
