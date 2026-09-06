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
  try {
    await globalThis.navigator.clipboard.writeText(svg)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// VIEW-04 — provenance-stamped representation export. String-based (no DOM)
// so frozen evidence bytes are deterministic and testable in Node. Reuses
// EXPORT_PRESETS / FigureExportSettings above — no new export engine.
// ---------------------------------------------------------------------------

/** Source identity stamped into every representation export. */
export interface FigureProvenanceStamp {
  kind: string
  datasetId: string | null
  versionId: string | null
  /** Pinned-config version (ChartSpec / PlateMapSpec / analysis definition). */
  configVersion: number
  /** Export wall-clock time, ISO-8601. Callers pin this for byte-identical rebuilds. */
  exportedAt: string
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeXmlComment(text: string): string {
  return text.replace(/--/g, '—')
}

/**
 * Human-readable provenance line for figure footers and CSV headers.
 * Live exports (no version pin) say `live` explicitly so a reader never
 * mistakes them for frozen evidence.
 */
export function buildFigureProvenanceLine(stamp: FigureProvenanceStamp): string {
  const parts: string[] = ['Sheetbase']
  if (stamp.datasetId) parts.push(`Dataset ${stamp.datasetId.slice(0, 8)}`)
  if (stamp.versionId) parts.push(`Version ${stamp.versionId.slice(0, 8)}`)
  else if (stamp.datasetId) parts.push('live')
  if (!stamp.datasetId && !stamp.versionId) parts.push(stamp.kind)
  parts.push(`config v${stamp.configVersion}`)
  parts.push(`Exported ${stamp.exportedAt}`)
  return parts.join(' · ')
}

/** Resolve an export preset into figure settings (dimensions + scale). */
export function presetFigureExport(
  preset: ExportPresetId,
  overrides?: Partial<FigureExportSettings>,
): FigureExportSettings {
  const dims = EXPORT_PRESETS[preset]
  return {
    ...DEFAULT_FIGURE_EXPORT,
    width: dims.width,
    height: dims.height,
    scale: dims.scale,
    ...overrides,
  }
}

/**
 * Stamp a serialised SVG figure with provenance: an XML comment carrying the
 * full identity plus a visible `<text>` footer line. Pure string surgery —
 * deterministic for a fixed stamp. When `includeProvenance` is false the SVG
 * passes through untouched.
 */
export function stampFigureSvg(
  svg: string,
  stamp: FigureProvenanceStamp,
  opts?: { includeProvenance?: boolean },
): string {
  if (opts?.includeProvenance === false) return svg
  const line = buildFigureProvenanceLine(stamp)
  const comment = `<!-- ${escapeXmlComment(line)} -->`
  const footer =
    `<text x="12" y="20" font-size="11" fill="#5D646F" ` +
    `font-family="Inter, sans-serif" data-sheetbase-provenance="true">${escapeXml(line)}</text>`
  const withComment = `${comment}\n${svg}`
  const closeAt = withComment.lastIndexOf('</svg>')
  if (closeAt < 0) return withComment
  return `${withComment.slice(0, closeAt)}${footer}${withComment.slice(closeAt)}`
}

/** `#`-prefixed header block for data (CSV) exports. */
export function buildDataExportHeaderLines(stamp: FigureProvenanceStamp): string[] {
  return [
    `# ${buildFigureProvenanceLine(stamp)}`,
    `# kind: ${stamp.kind}`,
    `# dataset_id: ${stamp.datasetId ?? 'none'}`,
    `# dataset_version_id: ${stamp.versionId ?? 'live'}`,
    `# config_version: ${stamp.configVersion}`,
    `# exported_at: ${stamp.exportedAt}`,
  ]
}

function csvEscapeCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\n#]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Serialise materialised rows to CSV under a provenance header block.
 * Deterministic for fixed inputs: same stamp + columns + rows → same bytes.
 */
export function serialiseRepresentationCsv(input: {
  columns: string[]
  rows: Array<Array<string | number | null>>
  stamp: FigureProvenanceStamp
}): string {
  const header = buildDataExportHeaderLines(input.stamp).join('\n')
  const body = [
    input.columns.map(csvEscapeCell).join(','),
    ...input.rows.map((row) => row.map(csvEscapeCell).join(',')),
  ].join('\n')
  return `${header}\n${body}\n`
}
