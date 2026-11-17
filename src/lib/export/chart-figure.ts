/** A chart reduced to what the signed record PDF draws. */
import type {
  ChartSpec,
  FacetedChart,
  MaterialisedChart,
} from '#/lib/chart-spec'

export interface FigureBox {
  lo: number
  q1: number
  median: number
  q3: number
  hi: number
  outliers: number[]
}

export interface FigureSeries {
  label: string
  color: string
  points: Array<{ x: number | null; y: number; label?: string }>
  box?: FigureBox
  /** Density samples along y, for a violin. */
  violin?: Array<{ y: number; d: number }>
}

export interface FigureHeatmap {
  xLabels: string[]
  yLabels: string[] | null
  cells: Array<{ x: number; y: number; value: number | null }>
  min: number | null
  max: number | null
}

/** A chart reduced to what the PDF draws. */
export interface PdfFigure {
  title: string
  /** Lines or markers on number axes, or bars per category. */
  kind: 'xy' | 'bar' | 'box' | 'violin' | 'hist' | 'heat'
  connect: boolean
  xLabel: string
  yLabel: string
  series: FigureSeries[]
  hlines: Array<{ value: number; label: string }>
  /** Histogram bin edges. */
  edges?: number[]
  heatmap?: FigureHeatmap
  /** One drawn chart per facet value, when the chart is faceted. */
  panels?: Array<{ value: string; figure: PdfFigure }>
  note: string | null
}

/** The notebook's axis title: the label, then the unit in brackets. */
function axisTitle(label: string, unit: string | undefined): string {
  return unit ? `${label} (${unit})` : label
}

const KIND_BY_TYPE = new Map<string, PdfFigure['kind']>([
  ['bar', 'bar'],
  ['grouped_bar', 'bar'],
  ['stacked_bar', 'bar'],
  ['summary', 'bar'],
  ['scatter', 'xy'],
  ['strip', 'xy'],
  ['line', 'xy'],
  ['scatter_line', 'xy'],
  ['connected_scatter', 'xy'],
  ['box', 'box'],
  ['violin', 'violin'],
  ['histogram', 'hist'],
  ['heatmap', 'heat'],
])

const LINE_TYPES = new Set(['line', 'scatter_line', 'connected_scatter'])

export function figureFromChart(
  title: string,
  spec: ChartSpec,
  chart: MaterialisedChart,
  facets?: readonly FacetedChart[] | null,
): PdfFigure | null {
  if (facets && facets.length > 0) {
    const panels = facets.flatMap((facet) => {
      const figure = figureFromChart(facet.value, spec, facet.chart)

      return figure ? [{ value: facet.value, figure }] : []
    })

    const first = panels.at(0)

    return first ? { ...first.figure, title, panels } : null
  }

  const type = spec.type
  const kind = KIND_BY_TYPE.get(type)

  if (!kind) return null

  const series = chart.series
    .filter((s) => s.visible !== false)
    .map((s) => ({
      label: s.label,
      color: s.color,
      points: s.points.flatMap((p) =>
        p.y === null ? [] : [{ x: p.x, y: p.y, label: p.label }],
      ),
      box: s.points.find((p) => p.box)?.box,
      violin: s.violin,
    }))
    .filter((s) => s.points.length > 0 || s.box || s.violin)

  const heat = chart.heatmap

  if (kind === 'heat' ? !heat || heat.cells.length === 0 : series.length === 0)
    return null

  return {
    title,
    kind,
    connect: LINE_TYPES.has(type),
    xLabel: axisTitle(chart.xLabel, chart.xUnit),
    yLabel: axisTitle(chart.yLabel, chart.yUnit),
    series: kind === 'heat' ? [] : series,
    hlines: (spec.overlays.references ?? []).flatMap((r) =>
      r.kind === 'hline' ? [{ value: r.value, label: r.label }] : [],
    ),
    edges: kind === 'hist' ? chart.bins?.edges : undefined,
    heatmap: kind === 'heat' ? heat : undefined,
    note: null,
  }
}
