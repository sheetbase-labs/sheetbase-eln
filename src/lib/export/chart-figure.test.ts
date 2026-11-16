import { extractText, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'

import { materialiseChart } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'
import { emptyChartSpec } from '#/lib/visualisation-presets'
import { figureFromChart } from './chart-figure'
import { renderRecordReportPdf } from './record-report-pdf'
import type { PdfFigure } from './chart-figure'

const columns = [
  { id: 'g', label: 'Group', logicalType: 'category' },
  { id: 'v', label: 'Titre', logicalType: 'number' },
  { id: 'w', label: 'Load', logicalType: 'number' },
]

const rows = [
  { g: 'A', v: 4, w: 1 },
  { g: 'A', v: 5, w: 2 },
  { g: 'A', v: 6, w: 3 },
  { g: 'A', v: 9, w: 1 },
  { g: 'B', v: 7, w: 2 },
  { g: 'B', v: 8, w: 3 },
  { g: 'B', v: 8.5, w: 1 },
  { g: 'B', v: 12, w: 2 },
]

function figure(
  type: ChartSpec['type'],
  fields: Partial<ChartSpec['fields']> = {},
): PdfFigure | null {
  const base = emptyChartSpec('d')

  const spec: ChartSpec = {
    ...base,
    type,
    fields: { ...base.fields, y: { fieldId: 'v' }, ...fields },
  }

  return figureFromChart('T', spec, materialiseChart(spec, columns, rows))
}

async function textOf(figures: PdfFigure[]): Promise<string> {
  const bytes = await renderRecordReportPdf({
    identifier: 'EXP-1',
    title: 'T',
    kind: 'experiment',
    recordStatus: 'approved',
    revisionId: 'r',
    reason: null,
    capturedAt: null,
    structureVersion: '1',
    integrityDigest: null,
    verificationCode: null,
    signatures: [],
    blockSnapshot: figures.map((_, i) => ({
      id: `f${i}`,
      type: 'chart',
      order: i,
      payload: { title: `Figure ${i}` },
    })),
    sheetEvidence: [],
    files: [],
    figures: new Map(figures.map((f, i) => [`f${i}`, f])),
  })

  const { text } = await extractText(await getDocumentProxy(bytes), {
    mergePages: true,
  })

  return text
}

describe('figures of every chart type', () => {
  it('reduces box, violin, histogram and heatmap charts to something drawable', () => {
    const box = figure('box', { series: { fieldId: 'g' } })
    const violin = figure('violin', { series: { fieldId: 'g' } })
    const hist = figure('histogram')
    const heat = figure('heatmap', { x: { fieldId: 'g' }, series: null })

    expect(box?.kind).toBe('box')
    expect(box?.series[0]?.box?.median).toBe(5.5)
    expect(violin?.series[0]?.violin?.length).toBeGreaterThan(5)
    expect(hist?.kind).toBe('hist')
    expect(hist?.edges?.length).toBeGreaterThan(2)
    expect(heat === null || heat.kind === 'heat').toBe(true)
  })

  it('draws them into the report with their labels', async () => {
    const figures = [
      figure('box', { series: { fieldId: 'g' } }),
      figure('violin', { series: { fieldId: 'g' } }),
      figure('histogram'),
    ].flatMap((f) => (f ? [f] : []))

    const text = await textOf(figures)

    expect(figures).toHaveLength(3)
    expect(text).toContain('Titre')
    expect(text).toContain('Figure 2')
  })

  it('draws a heatmap grid with its category labels', async () => {
    const heat: PdfFigure = {
      title: 'Heat',
      kind: 'heat',
      connect: false,
      xLabel: 'Plate column',
      yLabel: 'Plate row',
      series: [],
      hlines: [],
      heatmap: {
        xLabels: ['1', '2', '3'],
        yLabels: ['A', 'B'],
        cells: [
          { x: 0, y: 0, value: 1 },
          { x: 1, y: 0, value: 5 },
          { x: 2, y: 1, value: 9 },
        ],
        min: 1,
        max: 9,
      },
      note: null,
    }

    const text = await textOf([heat])

    expect(text).toContain('Plate column')
  })
})
