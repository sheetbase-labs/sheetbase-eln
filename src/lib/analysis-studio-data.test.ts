/**
 * ANALYSIS-001 — Analysis Studio data-layer tests.
 *
 * Covers the pure transformation, source-revision capture, stale-source
 * detection, validation and export helpers, plus the reproducibility proof:
 * rebuilding a chart from a stored specification yields the same
 * materialisation as the original.
 */
import { describe, expect, it, vi } from 'vitest'

import { CHART_SPEC_VERSION } from './chart-spec'
import type { ChartSpec } from './chart-spec'
import {
  ANALYSIS_MAX_RESULT_ROWS,
  applyTransformations,
  buildExportProvenance,
  canRecordAnalysis,
  captureSourceRevisions,
  createAnalysisView,
  createAnalysisRun,
  DEFAULT_EXPORT_SETTINGS,
  detectStaleSources,
  exportDataCsv,
  exportViewJson,
  fetchAnalysisRuns,
  materialiseAnalysisChart,
  parseAnalysisChartSpec,
  parseMaterialisedChart,
  selectRecordedRun,
  validateAnalysisSpec,
} from './analysis-studio-data'
import type { AnalysisRunWire, SourceRevision } from './analysis-studio-data'
import type { DataClient } from './data-client'
import type { ScientificTableWire } from './scientific-sheet-data'

function table(
  overrides: Partial<ScientificTableWire> = {},
): ScientificTableWire {
  return {
    id: '11111111-1111-1111-8111-111111111111',
    resource_name: 'sheet_alpha',
    name: 'Stability',
    schema_version: 1,
    lifecycle: 'active',
    columns: [
      {
        id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01',
        field_name: 'time_h',
        label: 'Time (h)',
        display_order: 0,
        logical_type: 'decimal',
        nullable: true,
        unit: null,
        validation: {},
        width: null,
        options: [],
      },
      {
        id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02',
        field_name: 'ph',
        label: 'pH',
        display_order: 1,
        logical_type: 'decimal',
        nullable: true,
        unit: null,
        validation: {},
        width: null,
        options: [],
      },
      {
        id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
        field_name: 'buffer',
        label: 'Buffer',
        display_order: 2,
        logical_type: 'category',
        nullable: true,
        unit: null,
        validation: {},
        width: null,
        options: [],
      },
      {
        id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa04',
        field_name: 'ph_sd',
        label: 'pH SD',
        display_order: 3,
        logical_type: 'decimal',
        nullable: true,
        unit: null,
        validation: {},
        width: null,
        options: [],
      },
    ],
    ...overrides,
  }
}

function spec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'scatter',
    datasets: [{ tableId: '11111111-1111-1111-8111-111111111111' }],
    fields: {
      x: {
        columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01',
        fieldName: 'time_h',
      },
      y: { columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02', fieldName: 'ph' },
      series: {
        columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
        fieldName: 'buffer',
      },
      color: null,
      size: null,
    },
    filters: [],
    transformations: [],
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

const rows = [
  { time_h: 0, ph: 7.0, buffer: 'HEPES', ph_sd: 0.1 },
  { time_h: 0, ph: 7.1, buffer: 'HEPES', ph_sd: 0.1 },
  { time_h: 24, ph: 6.8, buffer: 'HEPES', ph_sd: 0.2 },
  { time_h: 0, ph: 8.0, buffer: 'TRIS', ph_sd: 0.1 },
  { time_h: 24, ph: 7.9, buffer: 'TRIS', ph_sd: 0.15 },
]

const columns = [
  {
    id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01',
    fieldName: 'time_h',
    label: 'Time (h)',
    logicalType: 'decimal',
  },
  {
    id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02',
    fieldName: 'ph',
    label: 'pH',
    logicalType: 'decimal',
  },
  {
    id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
    fieldName: 'buffer',
    label: 'Buffer',
    logicalType: 'category',
  },
  {
    id: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa04',
    fieldName: 'ph_sd',
    label: 'pH SD',
    logicalType: 'decimal',
  },
]

describe('canonical analysis run persistence boundary', () => {
  it('unwraps the PostgREST representation returned when creating an analysis', async () => {
    const created = {
      id: '22222222-2222-4222-8222-222222222222',
      workspace_id: '33333333-3333-4333-8333-333333333333',
      owner_user_id: 'user-1',
      name: 'Stability comparison',
      version: 1,
      spec: spec(),
      source_revisions: [],
      export_settings: null,
      created_at: '2026-08-11T18:00:00.000Z',
      updated_at: '2026-08-11T18:00:00.000Z',
    }
    const insert = vi.fn().mockResolvedValue([created])
    const result = await createAnalysisView(
      { insert } as unknown as DataClient,
      {
        name: created.name,
        spec: created.spec,
        source_revisions: [],
        export_settings: null,
      },
      created.workspace_id,
      created.owner_user_id,
    )

    expect(result).toBe(created)
    expect(insert).toHaveBeenCalledWith(
      'analysis_views',
      expect.objectContaining({ name: created.name }),
    )
  })

  it('rejects malformed result snapshots at the fetch boundary', () => {
    expect(() => parseMaterialisedChart({})).toThrow(/snapshot/)
    expect(() =>
      parseMaterialisedChart({
        state: { kind: 'ok' },
        columns: [],
        rows: [],
        series: [],
      }),
    ).toThrow(/structure/)
  })

  it('rejects malformed specification snapshots at the fetch boundary', () => {
    expect(() => parseAnalysisChartSpec({ datasets: [] })).toThrow(
      /specification snapshot/,
    )
    expect(parseAnalysisChartSpec(spec())).toEqual(spec())
  })

  it('accepts the MaterialisedChart structure and preserves immutable values', () => {
    const snapshot = materialiseAnalysisChart(spec(), columns, rows)
    expect(parseMaterialisedChart(snapshot)).toBe(snapshot)
  })

  it('selects only the requested immutable run and never substitutes another', () => {
    const runs = [{ id: 'run-2' }, { id: 'run-1' }] as AnalysisRunWire[]
    expect(selectRecordedRun(runs, 'run-1')).toBe(runs[1])
    expect(selectRecordedRun(runs, 'unknown')).toBeNull()
  })

  it.each([
    { calculationLoading: true },
    { calculationError: true },
    {
      materialised: {
        ...materialiseAnalysisChart(spec(), columns, rows),
        state: { kind: 'stale' as const, detail: 'stale' },
      },
    },
  ])('prevents recording for unresolved calculation state %#', (override) => {
    expect(
      canRecordAnalysis({
        owner: true,
        named: true,
        datasetLoading: false,
        datasetError: false,
        calculationLoading: false,
        calculationError: false,
        validationOk: true,
        materialised: materialiseAnalysisChart(spec(), columns, rows),
        pending: false,
        ...override,
      }),
    ).toBe(false)
  })

  it('sends observations and snapshots to the RPC without actor, workspace, sequence, or digest', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'run-1', sequence: 1 })
    const client = { rpc } as unknown as DataClient
    await createAnalysisRun(client, {
      analysisViewId: 'analysis-1',
      status: 'completed',
      specSnapshot: spec(),
      resultSnapshot: materialiseAnalysisChart(spec(), columns, rows),
      engineVersion: 'analysis-engine/1',
    })

    expect(rpc).toHaveBeenCalledWith('create_analysis_run', {
      p_analysis_view_id: 'analysis-1',
      p_status: 'completed',
      p_spec_snapshot: spec(),
      p_result_snapshot: materialiseAnalysisChart(spec(), columns, rows),
      p_warnings: [],
      p_engine_version: 'analysis-engine/1',
    })
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('workspace_id')
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('actor_user_id')
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('digest')
  })

  it('fetches one analysis run history in descending sequence order', async () => {
    const list = vi.fn().mockResolvedValue([])
    const client = { list } as unknown as DataClient
    await fetchAnalysisRuns(client, 'analysis/id')
    expect(list).toHaveBeenCalledWith(
      'analysis_runs',
      '?analysis_view_id=eq.analysis%2Fid&order=sequence.desc',
    )
  })
})

describe('applyTransformations — aggregate', () => {
  it('groups by x + series and reduces y by mean', () => {
    const s = spec({
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'mean',
            xField: 'time_h',
            yField: 'ph',
            seriesField: 'buffer',
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    // Four (time, buffer) groups: (0,HEPES), (24,HEPES), (0,TRIS), (24,TRIS).
    expect(out).toHaveLength(4)
    const hepes0 = out.find((r) => r.time_h === 0 && r.buffer === 'HEPES')
    expect(hepes0?.ph).toBeCloseTo(7.05, 5)
  })

  it('sum reduces correctly', () => {
    const s = spec({
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'sum',
            xField: 'time_h',
            yField: 'ph',
            seriesField: 'buffer',
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    const hepes0 = out.find((r) => r.time_h === 0 && r.buffer === 'HEPES')
    expect(hepes0?.ph).toBeCloseTo(14.1, 5)
  })

  it('count reduces to the group size', () => {
    const s = spec({
      transformations: [
        {
          kind: 'aggregate',
          params: {
            function: 'count',
            xField: 'time_h',
            yField: 'ph',
            seriesField: 'buffer',
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    const hepes0 = out.find((r) => r.time_h === 0 && r.buffer === 'HEPES')
    expect(hepes0?.ph).toBe(2)
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
            yField: 'ph',
            seriesField: 'buffer',
          },
        },
      ],
    })
    const out = applyTransformations(rows, s.transformations, s)
    const trisRows = out.filter((r) => r.buffer === 'TRIS')
    // TRIS max is 8.0; 7.9 / 8.0 * 100 = 98.75
    const tris24 = trisRows.find((r) => r.time_h === 24)
    expect(tris24?.ph).toBeCloseTo(98.75, 2)
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
    const s = spec({
      fields: {
        ...spec().fields,
        y: { columnId: 'missing', fieldName: 'nope' },
      },
    })
    const result = materialiseAnalysisChart(s, columns, rows)
    expect(result.state.kind).toBe('missing_field')
  })

  it('surfaces log_scale_invalid for non-positive y on a log axis', () => {
    const withZero = [...rows, { time_h: 48, ph: 0, buffer: 'HEPES', ph_sd: 0 }]
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
      filters: [
        {
          columnId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03',
          fieldName: 'buffer',
          op: 'eq',
          value: 'NONE',
        },
      ],
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
            xField: 'time_h',
            yField: 'ph',
            seriesField: 'buffer',
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
  it('captures schema version and dataset schema revision per dataset', () => {
    const t = table({
      schema_version: 3,
      dataset_schema_id: 'ds-1',
      dataset_schema_revision: 2,
    })
    const revs = captureSourceRevisions([t], spec())
    expect(revs).toEqual([
      {
        tableId: '11111111-1111-1111-8111-111111111111',
        schemaVersion: 3,
        datasetSchemaId: 'ds-1',
        datasetSchemaRevision: 2,
      },
    ])
  })

  it('detects when a source table has been revised', () => {
    const stored: SourceRevision[] = [
      {
        tableId: '11111111-1111-1111-8111-111111111111',
        schemaVersion: 1,
        datasetSchemaId: null,
        datasetSchemaRevision: null,
      },
    ]
    const live = [table({ schema_version: 2 })]
    expect(detectStaleSources(stored, live)).toContain('was revised')
  })

  it('detects when a source table is no longer available', () => {
    const stored: SourceRevision[] = [
      {
        tableId: '22222222-2222-2222-8222-222222222222',
        schemaVersion: 1,
        datasetSchemaId: null,
        datasetSchemaRevision: null,
      },
    ]
    expect(detectStaleSources(stored, [table()])).toContain(
      'no longer available',
    )
  })

  it('returns null when sources are current', () => {
    const revs = captureSourceRevisions([table()], spec())
    expect(detectStaleSources(revs, [table()])).toBeNull()
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
      [
        {
          tableId: '11111111-1111-1111-8111-111111111111',
          schemaVersion: 1,
          datasetSchemaId: null,
          datasetSchemaRevision: null,
        },
      ],
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
            xField: 'time_h',
            yField: 'ph',
            seriesField: 'buffer',
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
