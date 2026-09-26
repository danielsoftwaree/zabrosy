const SVG_NS = 'http://www.w3.org/2000/svg'
const copiedStyles = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'text-anchor'] as const

export async function sectorToPng(svg: SVGSVGElement): Promise<Blob> {
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('xmlns', SVG_NS)
  copy.setAttribute('width', '1200')
  const height = Math.round(1200 * svg.viewBox.baseVal.height / svg.viewBox.baseVal.width)
  copy.setAttribute('height', String(height))
  const originals = [svg, ...svg.querySelectorAll('*')]
  const copies = [copy, ...copy.querySelectorAll('*')]
  originals.forEach((source, index) => {
    const styles = getComputedStyle(source)
    copiedStyles.forEach((name) => copies[index].setAttribute(name, styles.getPropertyValue(name)))
  })
  const background = getComputedStyle(svg).backgroundColor
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Экспорт PNG недоступен в этом браузере.')
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const loaded = new Image()
      loaded.onload = () => resolve(loaded)
      loaded.onerror = () => reject(new Error('Не удалось подготовить схему для PNG.'))
      loaded.src = url
    })
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG не создан.')), 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}
