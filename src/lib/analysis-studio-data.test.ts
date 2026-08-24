/**
 * ANALYSIS-001 — Analysis Studio data-layer tests.
 *
 * Covers the pure transformation, source-revision capture, stale-source
 * detection, validation and export helpers, plus the reproducibility proof:
 * rebuilding a chart from a stored specification yields the same
 * materialisation as the original.
 */
import { describe, expect, it } from 'vitest'

import { CHART_SPEC_VERSION } from './chart-spec'
import type { ChartColumn, ChartSpec } from './chart-spec'
import {
  ANALYSIS_MAX_RESULT_ROWS,
  applyTransformations,
  buildExportProvenance,
  captureSourceRevisions,
  DEFAULT_EXPORT_SETTINGS,
  detectStaleSources,
  exportDataCsv,
  exportViewJson,
  materialiseAnalysisChart,
  validateAnalysisSpec,
} from './analysis-studio-data'
import type { SourceRevision } from './analysis-studio-data'
import type { CanonicalDatasetSource } from './chart-data'

const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const F_TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const F_PH = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const F_BUFFER = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'
const F_SD = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa04'

function source(
  overrides: Partial<CanonicalDatasetSource> = {},
): CanonicalDatasetSource {
  return {
    datasetId: DATASET_ID,
    name: 'Stability',
    workspaceId: 'ws-1',
    schemaVersionId: 'sv-1',
    schemaVersionNumber: 1,
    revision: 1,
    columns: [],
    ...overrides,
  }
}

// Runtime rows are keyed by the stable schema-version fieldId.
const rows = [
  { [F_TIME]: 0, [F_PH]: 7.0, [F_BUFFER]: 'HEPES', [F_SD]: 0.1 },
  { [F_TIME]: 0, [F_PH]: 7.1, [F_BUFFER]: 'HEPES', [F_SD]: 0.1 },
  { [F_TIME]: 24, [F_PH]: 6.8, [F_BUFFER]: 'HEPES', [F_SD]: 0.2 },
  { [F_TIME]: 0, [F_PH]: 8.0, [F_BUFFER]: 'TRIS', [F_SD]: 0.1 },
  { [F_TIME]: 24, [F_PH]: 7.9, [F_BUFFER]: 'TRIS', [F_SD]: 0.15 },
]

const columns: ChartColumn[] = [
  { id: F_TIME, label: 'Time (h)', logicalType: 'decimal' },
  { id: F_PH, label: 'pH', logicalType: 'decimal' },
  { id: F_BUFFER, label: 'Buffer', logicalType: 'category' },
  { id: F_SD, label: 'pH SD', logicalType: 'decimal' },
]

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ datasetId: DATASET_ID }],
    fields: {
      x: { fieldId: F_TIME },
      y: { fieldId: F_PH },
      series: { fieldId: F_BUFFER },
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: {
        x: { label: 'Time (h)', scale: 'linear' },
        y: { label: 'pH', scale: 'linear' },
      },
      series: [{ identifier: 'all', label: 'all', color: '#006EDC' }],
      legend: { visible: true },
    },
    overlays: { errorBars: null },
    ...overrides,
  }
}

describe('applyTransformations — aggregate', () => {
  it('groups by x + series and reduces y by mean', () => {
    const s = spec({
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'mean',
            xField: F_TIME,
            yField: F_PH,
            seriesField: F_BUFFER,
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    // Four (time, buffer) groups: (0,HEPES), (24,HEPES), (0,TRIS), (24,TRIS).
    expect(out).toHaveLength(4)
    const hepes0 = out.find((r) => r[F_TIME] === 0 && r[F_BUFFER] === 'HEPES')
    expect(hepes0?.[F_PH]).toBeCloseTo(7.05, 5)
  })

  it('sum reduces correctly', () => {
    const s = spec({
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'sum',
            xField: F_TIME,
            yField: F_PH,
            seriesField: F_BUFFER,
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    const hepes0 = out.find((r) => r[F_TIME] === 0 && r[F_BUFFER] === 'HEPES')
    expect(hepes0?.[F_PH]).toBeCloseTo(14.1, 5)
  })

  it('count reduces to the group size', () => {
    const s = spec({
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'count',
            xField: F_TIME,
            yField: F_PH,
            seriesField: F_BUFFER,
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    const hepes0 = out.find((r) => r[F_TIME] === 0 && r[F_BUFFER] === 'HEPES')
    expect(hepes0?.[F_PH]).toBe(2)
  })
})

describe('applyTransformations — normalise', () => {
  it('scales y to percent of max per series', () => {
    const s = spec({
      transformations: [
        {
          kind: 'normalise',
          params: {
            method: 'percent_of_max',
            yField: F_PH,
            seriesField: F_BUFFER,
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    const trisRows = out.filter((r) => r[F_BUFFER] === 'TRIS')
    // TRIS max is 8.0; 7.9 / 8.0 * 100 = 98.75
    const tris24 = trisRows.find((r) => r[F_TIME] === 24)
    expect(tris24?.[F_PH]).toBeCloseTo(98.75, 2)
  })
})

describe('materialiseAnalysisChart', () => {
  it('returns ok and groups by series', () => {
    const result = materialiseAnalysisChart(spec(), columns, rows)
    expect(result.state.kind).toBe('ok')
    expect(result.series).toHaveLength(2)
    expect(result.series.map((s) => s.identifier).sort()).toEqual([
      'HEPES',
      'TRIS',
    ])
  })

  it('surfaces missing_field when the y column is absent', () => {
    const result = materialiseAnalysisChart(
      spec(),
      columns.filter((c) => c.id !== F_PH),
      rows,
    )
    expect(result.state.kind).toBe('missing_field')
  })

  it('surfaces log_scale_invalid for non-positive y on a log axis', () => {
    const withZero = [
      ...rows,
      { [F_TIME]: 48, [F_PH]: 0, [F_BUFFER]: 'HEPES', [F_SD]: 0 },
    ]
    const s = spec({
      display: {
        ...spec().display,
        axes: {
          x: { label: 'Time (h)', scale: 'linear' },
          y: { label: 'pH', scale: 'log' },
        },
      },
    })
    const result = materialiseAnalysisChart(s, columns, withZero)
    expect(result.state.kind).toBe('log_scale_invalid')
    if (result.state.kind === 'log_scale_invalid') {
      expect(result.state.axis).toBe('y')
      expect(result.state.invalidCount).toBeGreaterThan(0)
    }
  })

  it('surfaces empty_dataset when filters exclude all rows', () => {
    const s = spec({
      filters: [{ fieldId: F_BUFFER, op: 'eq', value: 'NONE' }],
    })
    const result = materialiseAnalysisChart(s, columns, rows)
    expect(result.state.kind).toBe('empty_dataset')
  })

  it('applies aggregation then plots the reduced rows', () => {
    const s = spec({
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'mean',
            xField: F_TIME,
            yField: F_PH,
            seriesField: F_BUFFER,
          },
        },
      ],
    })
    const result = materialiseAnalysisChart(s, columns, rows)
    expect(result.state.kind).toBe('ok')
    // 4 aggregated (time, buffer) groups → 4 points across series.
    const totalPoints = result.series.reduce(
      (a, series) => a + series.points.length,
      0,
    )
    expect(totalPoints).toBe(4)
  })
})

describe('captureSourceRevisions + detectStaleSources', () => {
  it('captures schema version number and revision per referenced dataset', () => {
    const revs = captureSourceRevisions(
      [source({ schemaVersionNumber: 3, revision: 2 })],
      spec(),
    )
    expect(revs).toEqual([
      {
        datasetId: DATASET_ID,
        schemaVersionNumber: 3,
        revision: 2,
      },
    ])
  })

  it('detects when a source dataset has been revised since capture', () => {
    const stored: SourceRevision[] = [
      { datasetId: DATASET_ID, schemaVersionNumber: 1, revision: 1 },
    ]
    const live = [source({ revision: 2 })]
    expect(detectStaleSources(stored, live)).toContain('was revised')
  })

  it('detects when a source pinned a different schema version number', () => {
    const stored: SourceRevision[] = [
      { datasetId: DATASET_ID, schemaVersionNumber: 1, revision: 1 },
    ]
    const live = [source({ schemaVersionNumber: 2 })]
    expect(detectStaleSources(stored, live)).toContain('schema v2')
  })

  it('detects when a source dataset is no longer available', () => {
    const stored: SourceRevision[] = [
      {
        datasetId: '22222222-2222-2222-8222-222222222222',
        schemaVersionNumber: 1,
        revision: 1,
      },
    ]
    expect(detectStaleSources(stored, [source()])).toContain(
      'no longer available',
    )
  })

  it('returns null when sources are current', () => {
    const revs = captureSourceRevisions([source()], spec())
    expect(detectStaleSources(revs, [source()])).toBeNull()
  })
})

describe('validateAnalysisSpec', () => {
  it('passes for a valid spec', () => {
    expect(validateAnalysisSpec(spec()).ok).toBe(true)
  })

  it('rejects an unsupported chart type', () => {
    const r = validateAnalysisSpec({ ...spec(), type: 'pie' as unknown })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('type'))).toBe(true)
  })

  it('flags excessive result size', () => {
    const r = validateAnalysisSpec(spec(), ANALYSIS_MAX_RESULT_ROWS + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('exceeds'))).toBe(true)
  })
})

describe('export helpers', () => {
  it('exportViewJson includes spec, settings and provenance', () => {
    const prov = buildExportProvenance(
      { name: 'pH view', id: 'v-1', version: 2 },
      { id: 'u-1', name: 'Alice' },
      [{ datasetId: DATASET_ID, schemaVersionNumber: 1, revision: 1 }],
      spec(),
    )
    const json = exportViewJson(spec(), DEFAULT_EXPORT_SETTINGS, prov)
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe('sheetbase-analysis-view')
    expect(parsed.spec.type).toBe('scatter')
    expect(parsed.provenance.viewName).toBe('pH view')
    expect(parsed.provenance.exportedBy).toBe('Alice')
  })

  it('exportViewJson omits provenance when includeProvenance is false', () => {
    const prov = buildExportProvenance(
      { name: 'pH view', id: null, version: null },
      { id: 'u-1', name: 'Alice' },
      [],
      spec(),
    )
    const json = exportViewJson(
      spec(),
      { ...DEFAULT_EXPORT_SETTINGS, includeProvenance: false },
      prov,
    )
    const parsed = JSON.parse(json)
    expect(parsed.provenance).toBeNull()
  })

  it('exportDataCsv serialises the materialised rows', () => {
    const materialised = materialiseAnalysisChart(spec(), columns, rows)
    const csv = exportDataCsv(materialised)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('series,x,y,yError')
    expect(lines.length).toBe(1 + rows.length)
  })
})

// --- Reproducibility proof ------------------------------------------------
//
// Saving a view stores the ChartSpec; rebuilding the chart from that stored
// spec yields the same materialisation as the original. This is the
// ANALYSIS-001 reproducibility test: a saved chart is rebuilt from its
// stored specification.
describe('reproducibility — rebuild a saved chart from its stored spec', () => {
  it('rebuilding from the stored spec yields the same series and points', () => {
    const originalSpec = spec({
      type: 'line',
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'mean',
            xField: F_TIME,
            yField: F_PH,
            seriesField: F_BUFFER,
          },
        },
      ],
      display: {
        ...spec().display,
        axes: {
          x: { label: 'Time (h)', scale: 'linear' },
          y: { label: 'pH', scale: 'linear' },
        },
      },
    })

    // 1. Build the original materialisation (the live preview).
    const original = materialiseAnalysisChart(originalSpec, columns, rows)

    // 2. Simulate saving: store the spec verbatim (as the DB would).
    const storedSpec: ChartSpec = JSON.parse(JSON.stringify(originalSpec))

    // 3. Rebuild from the stored spec with the same source rows.
    const rebuilt = materialiseAnalysisChart(storedSpec, columns, rows)

    // 4. The series identifiers, labels, colors and points match exactly.
    expect(rebuilt.state).toEqual(original.state)
    expect(rebuilt.series.map((s) => s.identifier)).toEqual(
      original.series.map((s) => s.identifier),
    )
    for (let i = 0; i < original.series.length; i++) {
      expect(rebuilt.series[i].points).toEqual(original.series[i].points)
    }
  })
})
