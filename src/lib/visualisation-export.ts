/**
 * SCI-04 figure export. Serialises the plotted SVG, not application chrome.
 */

export const EXPORT_PRESETS = {
  notebook: { width: 720, height: 420, scale: 1 },
  presentation: { width: 1280, height: 720, scale: 2 },
  publication: { width: 1800, height: 1200, scale: 3 },
} as const

export type ExportPresetId = keyof typeof EXPORT_PRESETS

export interface FigureExportSettings {
  format: 'svg' | 'png'
  width: number
  height: number
  scale: number
  background: 'opaque' | 'transparent'
  includeProvenance: boolean
}

export const DEFAULT_FIGURE_EXPORT: FigureExportSettings = {
  format: 'svg',
  width: 720,
  height: 420,
  scale: 2,
  background: 'opaque',
  includeProvenance: true,
}

export function serialiseChartSvg(
  svgEl: SVGSVGElement | null,
  settings: FigureExportSettings,
  comment?: string,
): string {
  if (!svgEl) return '<!-- Sheetbase: no chart rendered at export time -->'
  const clone = svgEl.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(settings.width))
  clone.setAttribute('height', String(settings.height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('viewBox', `0 0 ${settings.width} ${settings.height}`)
  if (settings.background === 'opaque') {
    clone.style.background = '#ffffff'
  }
  const serialised = new XMLSerializer().serializeToString(clone)
  const prefix = comment ? `${comment}\n` : ''
  return `${prefix}${serialised}`
}

export function svgContainsFigure(svg: string): boolean {
  return svg.includes('<svg') && !svg.includes('no chart rendered')
}

/** Rasterise an SVG string to a PNG blob. Browser-only. */
export async function rasteriseSvgToPng(
  svg: string,
  settings: FigureExportSettings,
): Promise<Blob> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('SVG rasterisation failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(settings.width * settings.scale)
    canvas.height = Math.round(settings.height * settings.scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    if (settings.background === 'opaque') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error('PNG encoding failed')),
        'image/png',
      )
    })
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function copySvgToClipboard(svg: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    await navigator.clipboard.writeText(svg)
    return true
  } catch {
    return false
  }
}
