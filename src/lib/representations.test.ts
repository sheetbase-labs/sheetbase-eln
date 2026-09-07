/**
 * VIEW-01 — representation contract tests. Each kind proves source
 * resolution, frozen-pin behaviour, read-only flags, and dispatcher parity
 * with the direct kind materialiser calls on fixtures. The framework adds no
 * computation of its own: parity is exact (`toEqual`), not approximate.
 */
import { describe, expect, it } from 'vitest'

import { ANALYSIS_DEFINITION_VERSION, runAnalysis } from './analysis-definition'
import type { AnalysisDefinition } from './analysis-definition'
import type { FrozenAnalysis } from './analysis-block'
import {
  materialiseFrozenChart,
  reconstructFrozenVisualisation,
} from './chart-data'
import type { ChartColumn, ChartSpec, FrozenChart } from './chart-spec'
import { CHART_SPEC_VERSION, materialiseChart } from './chart-spec'
import { PLATE_MAP_SPEC_VERSION, validatePlateMapSpec } from './plate-map'
import type { PlateMapSpec } from './plate-map'
import {
  SHEET_REPRESENTATION_CONFIG_VERSION,
  chartToRepresentationHandle,
  createRepresentationHandle,
  isFrozenRepresentation,
  materialiseRepresentation,
  pinnedVersionId,
  plateMapToRepresentationHandle,
  reconstructFrozenRepresentation,
  representationReadOnly,
} from './representations'
import type { RepresentationHandle } from './representations'

const DATASET_ID = '0198d970-e266-4000-8000-000000000001'
const VERSION_ID = '0198d970-e266-4000-8000-000000000010'
const RECORD_ID = '0198d970-e266-4000-8000-000000000099'
const INSTANCE_ID = '0198d970-e266-4000-8000-000000000020'
const COL_X = '0198d970-e266-4000-8000-000000000002'
const COL_Y = '0198d970-e266-4000-8000-000000000003'
const COL_G = '0198d970-e266-4000-8000-000000000004'

const COLUMNS: ChartColumn[] = [
  { id: COL_X, label: 'Time (h)', logicalType: 'integer' },
  { id: COL_Y, label: 'Signal', logicalType: 'decimal' },
  { id: COL_G, label: 'Condition', logicalType: 'text' },
]

const ROWS = [
  { [COL_X]: 0, [COL_Y]: 1, [COL_G]: 'a' },
  { [COL_X]: 1, [COL_Y]: 3, [COL_G]: 'a' },
  { [COL_X]: 2, [COL_Y]: 5, [COL_G]: 'b' },
  { [COL_X]: 3, [COL_Y]: 7, [COL_G]: 'b' },
]

function chartSpec(): ChartSpec {
  return {
    specVersion: CHART_SPEC_VERSION,
    type: 'line',
    datasets: [{ datasetId: DATASET_ID }],
    fields: {
      x: { fieldId: COL_X },
      y: { fieldId: COL_Y },
      series: null,
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
        y: { label: 'Signal', scale: 'linear' },
      },
      series: [],
    },
    overlays: { errorBars: null },
  }
}

function descriptiveDefinition(): AnalysisDefinition {
  return {
    definitionVersion: ANALYSIS_DEFINITION_VERSION,
    kind: 'descriptive',
    datasets: [{ datasetId: DATASET_ID }],
    value: { fieldId: COL_Y },
    group: { fieldId: COL_G },
  }
}

function plateSpec(): PlateMapSpec {
  return {
    specVersion: PLATE_MAP_SPEC_VERSION,
    format: '96_well',
    rows: 8,
    cols: 12,
    wells: [
      {
        wellCode: 'A1',
        row: 0,
        col: 0,
        role: 'sample',
        sampleRef: {
          recordId: RECORD_ID,
          identifier: 'SMP-1',
          title: 'Sample 1',
        },
      },
    ],
    validation: {},
  }
}

function frozenChart(): FrozenChart {
  const spec = chartSpec()
  const materialised = materialiseChart(spec, COLUMNS, ROWS)
  return {
    revisionId: null,
    frozenAt: '2026-01-01T00:00:00.000Z',
    frozenByUserId: '0198d970-e266-4000-8000-000000000030',
    datasetProvenance: [
      {
        datasetId: DATASET_ID,
        datasetVersionId: VERSION_ID,
        schemaVersionNumber: 1,
        rowCount: ROWS.length,
        checksum: 'abc123',
      },
    ],
    data: {
      columns: COLUMNS.map((c) => ({
        fieldId: c.id,
        label: c.label,
        logicalType: c.logicalType,
      })),
      rows: ROWS,
      series: materialised.series.map((s) => ({
        identifier: s.identifier,
        label: s.label,
        color: s.color,
        points: s.points,
      })),
    },
  }
}

function frozenAnalysis(): FrozenAnalysis {
  return {
    revisionId: null,
    frozenAt: '2026-01-01T00:00:00.000Z',
    frozenByUserId: '0198d970-e266-4000-8000-000000000030',
    definition: descriptiveDefinition(),
    definitionName: 'Signal by condition',
    definitionVersion: 1,
    columns: COLUMNS.map((c) => ({
      fieldId: c.id,
      label: c.label,
      logicalType: c.logicalType,
    })),
    datasetProvenance: [
      {
        datasetId: DATASET_ID,
        datasetVersionId: VERSION_ID,
        schemaVersionNumber: 1,
        sourceDatasetRevision: 3,
        rowCount: ROWS.length,
        checksum: 'abc123',
      },
    ],
  }
}

describe('representation read-only boundary', () => {
  it('marks chart/plate/analysis read-only and sheet editable', () => {
    expect(representationReadOnly('chart')).toBe(true)
    expect(representationReadOnly('plate_map')).toBe(true)
    expect(representationReadOnly('analysis')).toBe(true)
    expect(representationReadOnly('sheet')).toBe(false)
  })

  it('carries the derived flag on every handle', () => {
    const chart = createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: null },
      config: {
        kind: 'chart',
        configVersion: CHART_SPEC_VERSION,
        config: chartSpec(),
      },
    })
    const sheet = createRepresentationHandle({
      source: { datasetId: null, versionId: null },
      config: {
        kind: 'sheet',
        configVersion: SHEET_REPRESENTATION_CONFIG_VERSION,
        config: { instanceId: INSTANCE_ID },
      },
    })
    expect(chart.readOnly).toBe(true)
    expect(sheet.readOnly).toBe(false)
  })

  it('rejects a stale config version fail-closed', () => {
    expect(() =>
      createRepresentationHandle({
        source: { datasetId: DATASET_ID, versionId: null },
        config: {
          kind: 'chart',
          configVersion: 999,
          config: chartSpec(),
        } as unknown as RepresentationHandle['config'],
      }),
    ).toThrow(/configVersion must be/)
  })
})

describe('chart representation', () => {
  it('resolves source identity from the spec when live', () => {
    const handle = chartToRepresentationHandle({
      spec: chartSpec(),
      frozen: null,
      title: 'Trend',
    })!
    expect(handle.source.datasetId).toBe(DATASET_ID)
    expect(pinnedVersionId(handle)).toBeNull()
    expect(isFrozenRepresentation(handle)).toBe(false)
    expect(handle.provenance.summary).toContain('live')
  })

  it('prefers the frozen pin for source identity when frozen', () => {
    const handle = chartToRepresentationHandle({
      spec: chartSpec(),
      frozen: frozenChart(),
      title: 'Trend',
    })!
    expect(handle.source.datasetId).toBe(DATASET_ID)
    expect(pinnedVersionId(handle)).toBe(VERSION_ID)
    expect(isFrozenRepresentation(handle)).toBe(true)
    expect(handle.provenance.summary).toContain(VERSION_ID.slice(0, 8))
  })

  it('marks a frozen snapshot without a pin as frozen, not live', () => {
    const frozen = { ...frozenChart(), datasetProvenance: [] }
    const handle = chartToRepresentationHandle({
      spec: chartSpec(),
      frozen,
      title: 'Legacy',
    })!
    expect(isFrozenRepresentation(handle)).toBe(true)
    expect(pinnedVersionId(handle)).toBeNull()
    expect(handle.provenance.summary).toContain('snapshot')
  })

  it('keeps versionId null for multi-source frozen charts', () => {
    const frozen = {
      ...frozenChart(),
      datasetProvenance: [
        {
          datasetId: DATASET_ID,
          datasetVersionId: VERSION_ID,
          schemaVersionNumber: 1,
          rowCount: 1,
          checksum: 'aaa',
        },
        {
          datasetId: DATASET_ID,
          datasetVersionId: '0198d970-e266-4000-8000-000000000011',
          schemaVersionNumber: 1,
          rowCount: 1,
          checksum: 'bbb',
        },
      ],
    }
    const handle = chartToRepresentationHandle({
      spec: chartSpec(),
      frozen,
      title: 'Multi',
    })!
    expect(isFrozenRepresentation(handle)).toBe(true)
    expect(pinnedVersionId(handle)).toBeNull()
    expect(handle.source.datasetId).toBe(DATASET_ID)
  })

  it('returns null without a spec (legacy frozen snapshot)', () => {
    expect(
      chartToRepresentationHandle({ spec: null, frozen: frozenChart() }),
    ).toBeNull()
  })

  it('materialises live rows with parity to materialiseChart', () => {
    const handle = chartToRepresentationHandle({
      spec: chartSpec(),
      frozen: null,
    })!
    const out = materialiseRepresentation(handle, {
      columns: COLUMNS,
      rows: ROWS,
    })
    expect(out.kind).toBe('chart')
    if (out.kind !== 'chart') throw new Error('unreachable')
    expect(out.materialised).toEqual(
      materialiseChart(chartSpec(), COLUMNS, ROWS),
    )
    expect(out.materialised.state.kind).toBe('ok')
  })

  it('reconstructs frozen evidence with parity to the frozen path', () => {
    const frozen = frozenChart()
    const handle = chartToRepresentationHandle({ spec: chartSpec(), frozen })!
    const out = reconstructFrozenRepresentation(handle, frozen, {
      columns: COLUMNS,
      rows: ROWS,
    })
    expect(out.kind).toBe('chart')
    if (out.kind !== 'chart') throw new Error('unreachable')
    const direct = reconstructFrozenVisualisation({
      spec: chartSpec(),
      frozen,
      rows: ROWS,
    })
    expect(out.materialised).toEqual(direct.chart)
    expect(out.facets).toEqual(direct.facets)
  })

  it('replays the stored snapshot when no pinned rows are supplied', () => {
    const frozen = frozenChart()
    const handle = chartToRepresentationHandle({ spec: chartSpec(), frozen })!
    const out = reconstructFrozenRepresentation(handle, frozen)
    expect(out.kind).toBe('chart')
    if (out.kind !== 'chart') throw new Error('unreachable')
    expect(out.materialised).toEqual(materialiseFrozenChart(frozen))
  })
})

describe('analysis representation', () => {
  function handle(): RepresentationHandle {
    return createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: null },
      config: {
        kind: 'analysis',
        configVersion: ANALYSIS_DEFINITION_VERSION,
        config: descriptiveDefinition(),
      },
    })
  }

  it('resolves source identity from the definition datasets', () => {
    const h = handle()
    expect(h.source.datasetId).toBe(DATASET_ID)
    expect(h.readOnly).toBe(true)
  })

  it('materialises with parity to runAnalysis', () => {
    const out = materialiseRepresentation(handle(), {
      columns: COLUMNS,
      rows: ROWS,
    })
    expect(out).toEqual({
      kind: 'analysis',
      outcome: runAnalysis(descriptiveDefinition(), COLUMNS, ROWS),
    })
  })

  it('frozen reconstruction executes the verbatim snapshot, not live config', () => {
    // The live handle carries a *different* definition (ungrouped); frozen
    // evidence must still execute the frozen definition snapshot (grouped).
    const liveDiverged = createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: VERSION_ID },
      config: {
        kind: 'analysis',
        configVersion: ANALYSIS_DEFINITION_VERSION,
        config: {
          definitionVersion: ANALYSIS_DEFINITION_VERSION,
          kind: 'descriptive',
          datasets: [{ datasetId: DATASET_ID }],
          value: { fieldId: COL_Y },
        } satisfies AnalysisDefinition,
      },
    })
    const frozen = frozenAnalysis()
    const out = reconstructFrozenRepresentation(liveDiverged, frozen, {
      columns: COLUMNS,
      rows: ROWS,
    })
    expect(out).toEqual({
      kind: 'analysis',
      outcome: runAnalysis(frozen.definition, COLUMNS, ROWS),
    })
    if (out.kind !== 'analysis' || !out.outcome.ok)
      throw new Error('unreachable')
    // Grouped snapshot yields one row per condition.
    expect(out.outcome.result.rows.map((r) => r.group).sort()).toEqual([
      'a',
      'b',
    ])
  })

  it('reports empty_dataset honestly when pinned rows are absent', () => {
    const out = reconstructFrozenRepresentation(handle(), frozenAnalysis())
    expect(out).toEqual({
      kind: 'analysis',
      outcome: { ok: false, error: { code: 'empty_dataset' } },
    })
  })
})

describe('plate_map representation', () => {
  function handle(): RepresentationHandle {
    return createRepresentationHandle({
      source: { datasetId: null, versionId: null, recordId: RECORD_ID },
      config: {
        kind: 'plate_map',
        configVersion: PLATE_MAP_SPEC_VERSION,
        config: plateSpec(),
      },
    })
  }

  it('exposes the linked sample record for provenance display', () => {
    const h = handle()
    expect(h.source.recordId).toBe(RECORD_ID)
    expect(h.provenance.summary).toContain(RECORD_ID.slice(0, 8))
    expect(h.readOnly).toBe(true)
  })

  it('materialises with parity to validatePlateMapSpec (rows never copied)', () => {
    const spec = plateSpec()
    const out = materialiseRepresentation(handle(), { columns: [], rows: ROWS })
    expect(out).toEqual({
      kind: 'plate_map',
      errors: validatePlateMapSpec(spec),
      wellCount: 1,
    })
    if (out.kind !== 'plate_map') throw new Error('unreachable')
    expect(out.errors).toEqual([])
  })

  it('surfaces invalid specs with parity to the direct validator', () => {
    const bad = { ...plateSpec(), rows: 6 }
    const h = createRepresentationHandle({
      source: { datasetId: null, versionId: null },
      config: {
        kind: 'plate_map',
        configVersion: PLATE_MAP_SPEC_VERSION,
        config: bad,
      },
    })
    const out = materialiseRepresentation(h, { columns: [], rows: [] })
    expect(out).toEqual({
      kind: 'plate_map',
      errors: validatePlateMapSpec(bad),
      wellCount: bad.wells.length,
    })
    if (out.kind !== 'plate_map') throw new Error('unreachable')
    expect(out.errors.length).toBeGreaterThan(0)
  })

  it('rejects a frozen payload (plates have no freeze path)', () => {
    expect(() =>
      reconstructFrozenRepresentation(handle(), frozenChart(), {
        columns: COLUMNS,
        rows: ROWS,
      }),
    ).toThrow(/no frozen payload/)
  })
})

describe('plateMapToRepresentationHandle', () => {
  it('builds a live plate handle with no dataset binding', () => {
    const handle = plateMapToRepresentationHandle({
      spec: plateSpec(),
      title: 'qPCR plate',
    })!
    expect(handle.config.kind).toBe('plate_map')
    expect(handle.source).toEqual({
      datasetId: null,
      versionId: null,
    })
    expect(handle.readOnly).toBe(true)
    expect(handle.provenance.frozen).toBe(false)
    expect(handle.title).toBe('qPCR plate')
    // Rows are never part of the handle: materialisation re-validates the
    // spec and ignores caller-supplied rows.
    const out = materialiseRepresentation(handle, { columns: [], rows: ROWS })
    expect(out).toEqual({
      kind: 'plate_map',
      errors: [],
      wellCount: 1,
    })
  })

  it('builds a frozen handle for revision-snapshot reconstruction', () => {
    const handle = plateMapToRepresentationHandle({
      spec: plateSpec(),
      title: 'qPCR plate',
      frozen: true,
    })!
    expect(isFrozenRepresentation(handle)).toBe(true)
    expect(pinnedVersionId(handle)).toBeNull()
    // The pinned spec reconstructs through the frozen path with no payload.
    expect(reconstructFrozenRepresentation(handle, null)).toEqual({
      kind: 'plate_map',
      errors: [],
      wellCount: 1,
    })
  })

  it('returns null without a spec', () => {
    expect(plateMapToRepresentationHandle({ spec: null })).toBeNull()
  })
})

describe('sheet representation', () => {
  function handle(): RepresentationHandle {
    return createRepresentationHandle({
      source: { datasetId: null, versionId: null },
      config: {
        kind: 'sheet',
        configVersion: SHEET_REPRESENTATION_CONFIG_VERSION,
        config: { instanceId: INSTANCE_ID },
      },
    })
  }

  it('names the instance in the provenance summary and stays editable', () => {
    const h = handle()
    expect(h.readOnly).toBe(false)
    expect(h.provenance.summary).toContain(INSTANCE_ID.slice(0, 8))
  })

  it('passes instance identity through, ignoring rows', () => {
    expect(
      materialiseRepresentation(handle(), { columns: [], rows: [] }),
    ).toEqual({
      kind: 'sheet',
      instanceId: INSTANCE_ID,
    })
    expect(
      materialiseRepresentation(handle(), { columns: COLUMNS, rows: ROWS }),
    ).toEqual({ kind: 'sheet', instanceId: INSTANCE_ID })
    expect(reconstructFrozenRepresentation(handle(), null)).toEqual({
      kind: 'sheet',
      instanceId: INSTANCE_ID,
    })
  })
})

describe('dispatcher guards', () => {
  it('rejects frozen payloads of the wrong kind fail-closed', () => {
    const chartHandle = chartToRepresentationHandle({
      spec: chartSpec(),
      frozen: null,
    })!
    expect(() =>
      reconstructFrozenRepresentation(chartHandle, frozenAnalysis(), {
        columns: COLUMNS,
        rows: ROWS,
      }),
    ).toThrow(/FrozenChart/)
    const analysisHandle = createRepresentationHandle({
      source: { datasetId: DATASET_ID, versionId: VERSION_ID },
      config: {
        kind: 'analysis',
        configVersion: ANALYSIS_DEFINITION_VERSION,
        config: descriptiveDefinition(),
      },
    })
    expect(() =>
      reconstructFrozenRepresentation(analysisHandle, frozenChart(), {
        columns: COLUMNS,
        rows: ROWS,
      }),
    ).toThrow(/FrozenAnalysis/)
  })
})
