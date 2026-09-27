import { expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { areaAt, encBytes, encFeatureCollection, parseEncChart, type EncChart } from './enc-chart'

const chart: EncChart = {
  id: 'enc-current', name: 'test', source: 'test', verticalDatum: 'unknown', contours: [], soundings: [],
  areas: [{ shallowM: 2, deepM: 3, rings: [
    [{ lon: 0, lat: 0 }, { lon: 2, lat: 0 }, { lon: 2, lat: 2 }, { lon: 0, lat: 2 }],
    [{ lon: .5, lat: .5 }, { lon: 1.5, lat: .5 }, { lon: 1.5, lat: 1.5 }, { lon: .5, lat: 1.5 }],
  ] }],
}

it('opens a chart directly from a ZIP and keeps holes and depth ranges', () => {
  const zipped = zipSync({ 'ENC_ROOT/TEST.000': new Uint8Array([1, 2, 3]) })
  expect(encBytes('chart.zip', zipped)).toEqual({ name: 'TEST.000', bytes: new Uint8Array([1, 2, 3]) })
  expect(areaAt(chart, { lon: .2, lat: .2 })).toMatchObject({ shallowM: 2, deepM: 3 })
  expect(areaAt(chart, { lon: 1, lat: 1 })).toBeNull()
  expect(areaAt(chart, { lon: 3, lat: 3 })).toBeNull()
  expect(encFeatureCollection(chart).features[0].properties).toEqual({ kind: 'area', shallowM: 2, deepM: 3 })
})

it('rejects ambiguous, incomplete and malformed ENC files', async () => {
  const one = new Uint8Array([1, 2, 3])
  expect(() => encBytes('all.zip', zipSync({ 'A0000001.000': one, 'A0000002.000': one }))).toThrow('несколько листов')
  expect(() => encBytes('updated.zip', zipSync({ 'A0000001.000': one, 'A0000001.001': one }))).toThrow('обновления ENC')
  expect(() => encBytes('chart.txt', one)).toThrow('Выберите лист ENC')
  expect(() => encBytes('bad.zip', one)).toThrow('ZIP не удалось прочитать')
  await expect(parseEncChart('broken.000', one.buffer)).rejects.toThrow('Не удалось прочитать ENC')
})
