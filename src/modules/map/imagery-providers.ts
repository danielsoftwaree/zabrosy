export type ImageryProvider = {
  id: string
  label: string
  kind: 'wms' | 'xyz'
  url: string
  params?: Record<string, string>
  attribution: string
}

export const imageryProviders: ImageryProvider[] = [
  {
    id: 'gugik-high',
    label: 'Geoportal · подробная',
    kind: 'wms',
    url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution',
    params: { LAYERS: 'Raster', FORMAT: 'image/jpeg', VERSION: '1.1.1' },
    attribution: '© GUGiK / Geoportal',
  },
  {
    id: 'gugik-standard',
    label: 'Geoportal · стандартная',
    kind: 'wms',
    url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
    params: { LAYERS: 'Raster', FORMAT: 'image/jpeg', VERSION: '1.1.1' },
    attribution: '© GUGiK / Geoportal',
  },
  {
    id: 'esri-world',
    label: 'Esri · World Imagery',
    kind: 'xyz',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  },
]
