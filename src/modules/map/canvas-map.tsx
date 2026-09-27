import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import ImageLayer from 'ol/layer/Image.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import ImageWMS from 'ol/source/ImageWMS.js'
import XYZ from 'ol/source/XYZ.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import LineString from 'ol/geom/LineString.js'
import Polygon from 'ol/geom/Polygon.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import { encFeatureCollection, type EncChart } from './enc-chart'
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js'
import { defaults as defaultControls, ScaleLine } from 'ol/control.js'
import { unByKey } from 'ol/Observable.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style.js'
import type { EventsKey } from 'ol/events.js'
import type { Cast, Coordinate } from '../../shared/model'
import { lineLength } from '../survey'
import { CEGIELINKA, distanceMeters, fromLocalMeters, mapBounds } from './geometry'
import { imageryProviders, type ImageryProvider } from './imagery-providers'
import 'ol/ol.css'

export type MapImageStatus = 'loading' | 'ready' | 'error'
export type CanvasMapApi = {
  centerAt(point: Coordinate): void
  zoom(factor: number): void
  pan(east: number, north: number): void
  retry(): void
}
export type CanvasMapView = { center: number[]; resolution: number }

type Props = {
  apiRef: RefObject<CanvasMapApi | null>
  viewRef: RefObject<CanvasMapView | null>
  provider: ImageryProvider
  station: Coordinate | null
  referenceBearingDeg: number | null
  target: Coordinate | null
  casts: Cast[]
  encChart?: EncChart | null
  depthPoints?: { position: Coordinate; meters: number }[]
  toolPoints?: Coordinate[]
  toolMode?: 'distance' | 'photo' | null
  candidate: Coordinate | null
  locked: boolean
  onPick(point: Coordinate): void
  onStatus(status: MapImageStatus): void
  onWidth(meters: number): void
  onCenter(point: Coordinate): void
}

const coords = ({ lon, lat }: Coordinate) => fromLonLat([lon, lat])
const point = (coordinate: number[]): Coordinate => { const [lon, lat] = toLonLat(coordinate); return { lon, lat } }
const dark = '#18594a'
const light = '#fbfcf8'

function markerStyle(fill: string, label: string, radius = 10) {
  return new Style({
    image: new CircleStyle({ radius, fill: new Fill({ color: fill }), stroke: new Stroke({ color: light, width: 2 }) }),
    text: new Text({ text: label, offsetY: radius + 14, font: '700 11px system-ui', fill: new Fill({ color: dark }),
      backgroundFill: new Fill({ color: '#fbfcf8ef' }), padding: [4, 6, 4, 6] }),
  })
}

function lineStyle(color: string, dash: number[]) {
  return new Style({ stroke: new Stroke({ color, width: 2, lineDash: dash }) })
}

function features({ station, referenceBearingDeg, target, casts, candidate, toolPoints = [], toolMode }: Pick<Props, 'station' | 'referenceBearingDeg' | 'target' | 'casts' | 'candidate' | 'toolPoints' | 'toolMode'>) {
  const result: Feature[] = []
  const addPoint = (position: Coordinate, style: Style) => {
    const feature = new Feature(new Point(coords(position)))
    feature.setStyle(style)
    result.push(feature)
  }
  const addLine = (start: Coordinate, end: Coordinate, style: Style) => {
    const feature = new Feature(new LineString([coords(start), coords(end)]))
    feature.setStyle(style)
    result.push(feature)
  }
  if (station && referenceBearingDeg !== null) {
    const radians = referenceBearingDeg * Math.PI / 180
    addLine(station, fromLocalMeters(station, Math.sin(radians) * 400, Math.cos(radians) * 400), lineStyle('#eff8e9', [7, 7]))
  }
  for (const [index, cast] of casts.entries()) {
    if (!cast.target) continue
    if (cast.station.position) addLine(cast.station.position, cast.target, lineStyle('#d6edd8cc', [4, 6]))
    const measured = lineLength(cast)
    const label = measured === null ? `#${index + 1}` : `#${index + 1} · ≈${Math.round(measured)} м леска`
    addPoint(cast.target, markerStyle('#4d8067', label, 9))
  }
  if (station && target) addLine(station, target, lineStyle('#f4f9ee', [5, 5]))
  if (station) addPoint(station, markerStyle(dark, 'БЕРЕГ'))
  if (target) addPoint(target, markerStyle('#d8f285', station ? `Цель · ≈${Math.round(distanceMeters(station, target))} м по карте` : 'Цель', 11))
  if (candidate) addPoint(candidate, markerStyle('#2d765abb', 'Выбрана точка', 13))
  if (toolPoints.length > 1) {
    const path = toolPoints.map(coords)
    const feature = new Feature(toolPoints.length === 4 ? new Polygon([[...path, path[0]]]) : new LineString(path))
    feature.setStyle(new Style({ stroke: new Stroke({ color: '#d8f285', width: 3 }), fill: new Fill({ color: '#d8f28525' }) }))
    result.push(feature)
  }
  toolPoints.forEach((position, i) => addPoint(position, markerStyle('#d8f285', toolMode === 'distance' ? i ? 'Б · цель' : 'А · ваше место' : String(i + 1))))
  return result
}

function chartFeatures(chart: EncChart | null | undefined, depths: Props['depthPoints']) {
  const result: Feature[] = chart ? new GeoJSON().readFeatures(encFeatureCollection(chart), { featureProjection: 'EPSG:3857' }) : []
  for (const feature of result) {
    const kind = feature.get('kind')
    const depth = feature.get('depthM') as number | undefined
    if (kind === 'area') {
      const shallow = feature.get('shallowM') as number | null
      feature.setStyle(new Style({ fill: new Fill({ color: shallow === null ? '#718d9525' : `hsla(195,55%,${Math.max(28, 72 - shallow * 4)}%,0.26)` }), stroke: new Stroke({ color: '#def1f270', width: .5 }) }))
    } else if (kind === 'contour') feature.setStyle(new Style({ stroke: new Stroke({ color: '#ebfaffcc', width: 1.3 }), text: new Text({ text: `${depth} м`, placement: 'line', repeat: 180, font: '600 11px system-ui', fill: new Fill({ color: '#133f52' }), stroke: new Stroke({ color: '#fff', width: 3 }) }) }))
    else feature.setStyle(markerStyle('#81d5e8', `${depth} м`, 4))
  }
  for (const sample of depths ?? []) {
    const feature = new Feature(new Point(coords(sample.position)))
    feature.setStyle(markerStyle('#81d5e8', `${sample.meters} м`, 4))
    result.push(feature)
  }
  return result
}

export function CanvasMap({ apiRef, viewRef, provider, station, referenceBearingDeg, target, casts, candidate, toolPoints, toolMode, encChart, depthPoints, locked, onPick, onStatus, onWidth, onCenter }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const vectorRef = useRef<VectorSource | null>(null)
  const pickRef = useRef(onPick)
  const statusRef = useRef(onStatus)
  const widthRef = useRef(onWidth)
  const centerRef = useRef(onCenter)
  const lockedRef = useRef(locked)
  useEffect(() => {
    pickRef.current = onPick
    statusRef.current = onStatus
    widthRef.current = onWidth
    centerRef.current = onCenter
    lockedRef.current = locked
  }, [onPick, onStatus, onWidth, onCenter, locked])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const initial = mapBounds(CEGIELINKA, 140)
    const resolution = (fromLonLat([initial.east, CEGIELINKA.lat])[0] - fromLonLat([initial.west, CEGIELINKA.lat])[0]) / Math.max(host.clientWidth, 1)
    const view = new View({ projection: 'EPSG:3857', center: viewRef.current?.center ?? coords(CEGIELINKA), resolution: viewRef.current?.resolution ?? resolution,
      minResolution: resolution / 12, maxResolution: resolution * 15, enableRotation: false })
    const vector = new VectorSource()
    const map = new Map({ target: host, layers: [new VectorLayer({ source: vector })], view,
      controls: defaultControls({ attribution: false, rotate: false, zoom: false }).extend([new ScaleLine({ units: 'metric' })]),
      interactions: defaultInteractions({ altShiftDragRotate: false, pinchRotate: false, keyboard: false }), moveTolerance: 6 })
    mapRef.current = map
    vectorRef.current = vector
    let sourceKeys: EventsKey[] = []
    let timeout: number | undefined
    let retryCount = 0
    let loaded = false
    let everReady = false
    let pendingTiles = 0
    let activeProvider = provider
    const clearSource = () => { unByKey(sourceKeys); sourceKeys = []; window.clearTimeout(timeout); timeout = undefined }
    const bind = (selected: ImageryProvider) => {
      clearSource()
      activeProvider = selected
      loaded = false
      pendingTiles = 0
      if (!everReady) statusRef.current('loading')
      const url = `${selected.url}${retryCount ? `${selected.url.includes('?') ? '&' : '?'}_retry=${retryCount}` : ''}`
      const source = selected.kind === 'wms'
        ? new ImageWMS({ url, params: selected.params, ratio: 1.2, hidpi: false })
        : new XYZ({ url, attributions: selected.attribution, crossOrigin: 'anonymous', maxZoom: 19 })
      if (source instanceof ImageWMS) {
        sourceKeys = [
          source.on('imageloadstart', () => {
            loaded = false
            if (!everReady) statusRef.current('loading')
            window.clearTimeout(timeout)
            timeout = window.setTimeout(fail, selected.id === 'gugik-high' ? 8000 : 20000)
          }),
          source.on('imageloadend', () => { loaded = true; everReady = true; window.clearTimeout(timeout); statusRef.current('ready') }),
          source.on('imageloaderror', fail),
        ]
      } else {
        sourceKeys = [
          source.on('tileloadstart', () => { if (pendingTiles === 0) loaded = false; pendingTiles += 1; if (!everReady) statusRef.current('loading'); timeout ??= window.setTimeout(fail, 20000) }),
          source.on('tileloadend', () => { pendingTiles -= 1; loaded = true; everReady = true; window.clearTimeout(timeout); timeout = undefined; statusRef.current('ready') }),
          source.on('tileloaderror', () => { pendingTiles -= 1; if (pendingTiles <= 0 && !loaded) fail() }),
        ]
      }
      const layer = source instanceof ImageWMS ? new ImageLayer({ source }) : new TileLayer({ source })
      if (map.getLayers().getLength() === 1) map.getLayers().insertAt(0, layer)
      else map.getLayers().setAt(0, layer)
    }
    function fail() {
      if (loaded) return
      if (provider.id === 'gugik-high' && activeProvider.id !== 'gugik-standard')
        bind(imageryProviders.find(item => item.id === 'gugik-standard')!)
      else { clearSource(); statusRef.current('error') }
    }
    bind(provider)
    const mapKeys: EventsKey[] = [
      map.on('singleclick', event => { if (!lockedRef.current) pickRef.current(point(event.coordinate)) }),
      map.on('moveend', () => {
        centerRef.current(point(view.getCenter()!))
        const extent = view.calculateExtent(map.getSize())
        const west = point([extent[0], (extent[1] + extent[3]) / 2])
        const east = point([extent[2], (extent[1] + extent[3]) / 2])
        widthRef.current(distanceMeters(west, east))
      }),
    ]
    const api: CanvasMapApi = {
      centerAt(position) { view.animate({ center: coords(position), duration: 220 }) },
      zoom(factor) { view.animate({ resolution: view.getResolution()! * factor, duration: 180 }) },
      pan(east, north) {
        const center = point(view.getCenter()!)
        const extent = view.calculateExtent(map.getSize())
        const width = distanceMeters(point([extent[0], view.getCenter()![1]]), point([extent[2], view.getCenter()![1]]))
        view.animate({ center: coords(fromLocalMeters(center, east * width, north * width)), duration: 180 })
      },
      retry() { retryCount += 1; everReady = false; bind(provider) },
    }
    apiRef.current = api
    map.updateSize()
    return () => {
      apiRef.current = null
      viewRef.current = { center: view.getCenter()!.slice(), resolution: view.getResolution()! }
      clearSource()
      unByKey(mapKeys)
      map.setTarget(undefined)
      map.dispose()
      mapRef.current = null
      vectorRef.current = null
    }
  }, [apiRef, viewRef, provider])

  useEffect(() => {
    vectorRef.current?.clear()
    vectorRef.current?.addFeatures([...chartFeatures(encChart, depthPoints), ...features({ station, referenceBearingDeg, target, casts, candidate, toolPoints, toolMode })])
  }, [provider, station, referenceBearingDeg, target, casts, candidate, toolPoints, toolMode, encChart, depthPoints])

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const api = apiRef.current
    const map = mapRef.current
    if (!api || !map) return
    const movement: Record<string, [number, number]> = {
      ArrowUp: [0, .15], ArrowDown: [0, -.15], ArrowLeft: [-.15, 0], ArrowRight: [.15, 0],
    }
    if (event.key in movement) api.pan(...movement[event.key])
    else if (event.key === '+' || event.key === '=') api.zoom(.5)
    else if (event.key === '-') api.zoom(2)
    else if ((event.key === 'Enter' || event.key === ' ') && !lockedRef.current) pickRef.current(point(map.getView().getCenter()!))
    else return
    event.preventDefault()
  }

  return <div ref={hostRef} className="field-map__canvas" role="button" tabIndex={0} aria-label="Снимок участка. Коснитесь, чтобы отметить точку" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - Enter Space" onKeyDown={keyboard} />
}
