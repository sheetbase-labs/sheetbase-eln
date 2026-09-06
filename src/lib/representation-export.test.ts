/**
 * VIEW-04 — representation export, embedding & evidence tests.
 *
 * Provenance-stamped export (SVG footer + CSV header, reusing the existing
 * export presets), stable versioned embed configs (fail-closed), frozen
 * evidence reconstruction byte-parity, notebook embed coverage for chart /
 * plate / compare (compare embeds via the ChartSpec hand-off — no new block
 * type), and API-readable metadata through the existing blocks contract.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_DEFINITION_VERSION,
  runAnalysis,
} from './analysis-definition'
import type { AnalysisDefinition } from './analysis-definition'
import { validateBlock } from './blocks/index'
import { validateChartSpec } from './chart-spec'
import type { ChartColumn, ChartSpec } from './chart-spec'
import { CHART_SPEC_VERSION, materialiseChart } from './chart-spec'
import {
  COMPARATIVE_VIEW_CONFIG_VERSION,
  validateComparativeViewConfig,
} from './comparative-view'
import type { ComparativeViewConfig } from './comparative-view'
import { PLATE_MAP_SPEC_VERSION } from './plate-map'
import type { PlateMapSpec } from './plate-map'
import {
  SHEET_REPRESENTATION_CONFIG_VERSION,
  analysisToRepresentationHandle,
  chartToRepresentationHandle,
  comparativeViewToRepresentationHandle,
  plateMapToRepresentationHandle,
  reconstructFrozenRepresentation,
  representationExportStamp,
  serializeRepresentationMetadata,
  sheetToRepresentationHandle,
  validateRepresentationEmbed,
} from './representations'
import type { RepresentationHandle } from './representations'
import {
  EXPORT_PRESETS,
  buildDataExportHeaderLines,
  buildFigureProvenanceLine,
  presetFigureExport,
  serialiseRepresentationCsv,
  stampFigureSvg,
} from './visualisation-export'
import type { FigureProvenanceStamp } from './visualisation-export'

const DATASET_ID = '0198d970-e266-4000-8000-000000000001'
const VERSION_ID = '0198d970-e266-4000-8000-000000000010'
const RECORD_ID = '0198d970-e266-4000-8000-000000000099'
const INSTANCE_ID = '0198d970-e266-4000-8000-000000000020'
const COL_X = '0198d970-e266-4000-8000-000000000002'
const COL_Y = '0198d970-e266-4000-8000-000000000003'
const COL_G = '0198d970-e266-4000-8000-000000000004'

const EXPORTED_AT = '2026-09-06T12:00:00.000Z'

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

function chartHandle(): RepresentationHandle {
  return chartToRepresentationHandle({
    spec: chartSpec(),
    frozen: frozenChartPayload(),
    title: 'Trend',
  })!
}

function frozenChartPayload() {
  const materialised = materialiseChart(chartSpec(), COLUMNS, ROWS)
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

function frozenAnalysisPayload() {
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

describe('provenance-stamped figure export', () => {
  it('names dataset, pinned version and export time on frozen figures', () => {
    const stamp: FigureProvenanceStamp = {
      kind: 'chart',
      datasetId: DATASET_ID,
      versionId: VERSION_ID,
      configVersion: CHART_SPEC_VERSION,
      exportedAt: EXPORTED_AT,
    }
    const line = buildFigureProvenanceLine(stamp)
    expect(line).toContain(DATASET_ID.slice(0, 8))
    expect(line).toContain(VERSION_ID.slice(0, 8))
    expect(line).toContain(EXPORTED_AT)
    expect(line).not.toContain('live')
  })

  it('marks live figures live so they are never mistaken for evidence', () => {
    const line = buildFigureProvenanceLine({
      kind: 'chart',
      datasetId: DATASET_ID,
      versionId: null,
      configVersion: CHART_SPEC_VERSION,
      exportedAt: EXPORTED_AT,
    })
    expect(line).toContain('live')
    expect(line).toContain(DATASET_ID.slice(0, 8))
  })

  it('still stamps dataset-free representations with kind identity', () => {
    const line = buildFigureProvenanceLine({
      kind: 'plate_map',
      datasetId: null,
      versionId: null,
      configVersion: PLATE_MAP_SPEC_VERSION,
      exportedAt: EXPORTED_AT,
    })
    expect(line).toContain('plate_map')
    expect(line).toContain(EXPORTED_AT)
  })

  it('stamps SVG with a comment and a visible footer', () => {
    const stamp = representationExportStamp(chartHandle(), EXPORTED_AT)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'
    const stamped = stampFigureSvg(svg, stamp)
    expect(stamped).toContain('<!-- Sheetbase ·')
    expect(stamped).toContain('data-sheetbase-provenance="true"')
    expect(stamped).toContain(VERSION_ID.slice(0, 8))
    expect(stamped).toContain('</svg>')
  })

  it('leaves SVG untouched when provenance is excluded', () => {
    const stamp = representationExportStamp(chartHandle(), EXPORTED_AT)
    const svg = '<svg><circle r="4"/></svg>'
    expect(stampFigureSvg(svg, stamp, { includeProvenance: false })).toBe(svg)
  })

  it('resolves presets into figure settings without a new engine', () => {
    for (const preset of Object.keys(EXPORT_PRESETS)) {
      const settings = presetFigureExport(preset as keyof typeof EXPORT_PRESETS)
      const dims = EXPORT_PRESETS[preset as keyof typeof EXPORT_PRESETS]
      expect(settings.width).toBe(dims.width)
      expect(settings.height).toBe(dims.height)
      expect(settings.scale).toBe(dims.scale)
    }
  })
})

describe('provenance-stamped data export', () => {
  it('heads CSV with dataset, version, config and timestamp', () => {
    const stamp = representationExportStamp(chartHandle(), EXPORTED_AT)
    const lines = buildDataExportHeaderLines(stamp)
    expect(lines.some((l) => l.includes(DATASET_ID))).toBe(true)
    expect(lines.some((l) => l.includes(VERSION_ID))).toBe(true)
    expect(lines.some((l) => l.includes(EXPORTED_AT))).toBe(true)
    expect(lines.some((l) => l.includes(`config_version: ${CHART_SPEC_VERSION}`))).toBe(true)
    expect(lines.every((l) => l.startsWith('#'))).toBe(true)
  })

  it('serialises rows deterministically under the header', () => {
    const stamp = representationExportStamp(chartHandle(), EXPORTED_AT)
    const csv = serialiseRepresentationCsv({
      columns: ['time', 'signal'],
      rows: [
        [0, 1],
        [1, null],
      ],
      stamp,
    })
    expect(csv).toContain(`# dataset_version_id: ${VERSION_ID}`)
    expect(csv).toContain('time,signal')
    expect(csv).toContain('0,1')
    expect(csv).toContain('1,')
    expect(csv.endsWith('\n')).toBe(true)
  })
})

describe('frozen evidence reconstruction', () => {
  it('rebuilds identical chart bytes/data from the pin', () => {
    const handle = chartHandle()
    const frozen = frozenChartPayload()
    const input = { columns: COLUMNS, rows: ROWS }
    const first = reconstructFrozenRepresentation(handle, frozen as never, input)
    const second = reconstructFrozenRepresentation(handle, frozen as never, input)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    if (first.kind !== 'chart' || second.kind !== 'chart') throw new Error('unreachable')
    expect(first.materialised).toEqual(materialiseChart(chartSpec(), COLUMNS, ROWS))
    // The stamped figure is byte-identical for a pinned export timestamp.
    const stamp = representationExportStamp(handle, EXPORTED_AT)
    const svg = '<svg><circle r="4"/></svg>'
    expect(stampFigureSvg(svg, stamp)).toBe(stampFigureSvg(svg, stamp))
  })

  it('rebuilds identical analysis results from the verbatim snapshot', () => {
    const handle = analysisToRepresentationHandle({
      definition: descriptiveDefinition(),
      datasetId: DATASET_ID,
      versionId: VERSION_ID,
      title: 'Signal',
    })!
    const frozen = frozenAnalysisPayload()
    const input = { columns: COLUMNS, rows: ROWS }
    const first = reconstructFrozenRepresentation(handle, frozen as never, input)
    const second = reconstructFrozenRepresentation(handle, frozen as never, input)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first).toEqual({
      kind: 'analysis',
      outcome: runAnalysis(descriptiveDefinition(), COLUMNS, ROWS),
    })
    // CSV evidence is byte-identical for a pinned export timestamp.
    const stamp = representationExportStamp(handle, EXPORTED_AT)
    const csvAt = (rows: Array<Array<string | number | null>>) =>
      serialiseRepresentationCsv({ columns: ['signal'], rows, stamp })
    expect(csvAt([['a'], ['b']])).toBe(csvAt([['a'], ['b']]))
  })
})

describe('stable embed configs', () => {
  function embedInput() {
    return {
      kind: 'chart',
      configVersion: CHART_SPEC_VERSION,
      config: chartSpec(),
      source: { datasetId: DATASET_ID, versionId: null },
      title: 'Trend',
    }
  }

  it('accepts a versioned chart embed', () => {
    const result = validateRepresentationEmbed(embedInput())
    expect(result.ok).toBe(true)
    expect(result.handle?.config.kind).toBe('chart')
    expect(result.errors).toEqual([])
  })

  it('accepts plate, analysis and sheet embeds', () => {
    expect(
      validateRepresentationEmbed({
        kind: 'plate_map',
        configVersion: PLATE_MAP_SPEC_VERSION,
        config: plateSpec(),
        source: { datasetId: null, versionId: null },
      }).ok,
    ).toBe(true)
    expect(
      validateRepresentationEmbed({
        kind: 'analysis',
        configVersion: ANALYSIS_DEFINITION_VERSION,
        config: descriptiveDefinition(),
        source: { datasetId: DATASET_ID, versionId: null },
      }).ok,
    ).toBe(true)
    expect(
      validateRepresentationEmbed({
        kind: 'sheet',
        configVersion: SHEET_REPRESENTATION_CONFIG_VERSION,
        config: { instanceId: INSTANCE_ID },
        source: { datasetId: null, versionId: null },
      }).ok,
    ).toBe(true)
  })

  it('rejects unknown kinds fail-closed', () => {
    const result = validateRepresentationEmbed({
      kind: 'compare',
      configVersion: 1,
      config: {},
      source: { datasetId: null, versionId: null },
    })
    expect(result.ok).toBe(false)
    expect(result.handle).toBeUndefined()
    expect(result.errors.join(' ')).toMatch(/unknown representation kind/)
  })

  it('rejects stale config versions fail-closed', () => {
    const result = validateRepresentationEmbed({
      ...embedInput(),
      configVersion: 999,
    })
    expect(result.ok).toBe(false)
    expect(result.handle).toBeUndefined()
    expect(result.errors.join(' ')).toMatch(/configVersion must be/)
  })

  it('rejects configs the canonical validators reject', () => {
    const bad = validateRepresentationEmbed({
      ...embedInput(),
      config: { ...chartSpec(), type: 'not-a-chart' },
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join(' ')).toMatch(/ChartSpec/)
    const badSheet = validateRepresentationEmbed({
      kind: 'sheet',
      configVersion: SHEET_REPRESENTATION_CONFIG_VERSION,
      config: { instanceId: 'not-a-uuid' },
      source: { datasetId: null, versionId: null },
    })
    expect(badSheet.ok).toBe(false)
  })

  it('rejects non-UUID source identity', () => {
    const result = validateRepresentationEmbed({
      ...embedInput(),
      source: { datasetId: 'dataset-1', versionId: null },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/source\.datasetId/)
  })
})

describe('notebook embedding coverage', () => {
  it('embeds chart blocks through validation plus the chart adapter', () => {
    const spec = chartSpec()
    expect(
      validateBlock({ type: 'chart', payload: { spec, title: 'Trend' } }).ok,
    ).toBe(true)
    const handle = chartToRepresentationHandle({ spec, frozen: null, title: 'Trend' })
    expect(handle?.config.kind).toBe('chart')
    expect(validateRepresentationEmbed({
      kind: 'chart',
      configVersion: CHART_SPEC_VERSION,
      config: spec,
      source: { datasetId: DATASET_ID, versionId: null },
      title: 'Trend',
    }).ok).toBe(true)
  })

  it('embeds plate blocks through validation plus the plate adapter', () => {
    const spec = plateSpec()
    expect(
      validateBlock({ type: 'plate_map', payload: { spec, title: 'qPCR plate' } }).ok,
    ).toBe(true)
    const handle = plateMapToRepresentationHandle({ spec, title: 'qPCR plate' })
    expect(handle?.config.kind).toBe('plate_map')
    expect(handle?.readOnly).toBe(true)
  })

  it('embeds analysis and sheet payloads without new block types', () => {
    const analysis = analysisToRepresentationHandle({
      definition: descriptiveDefinition(),
      datasetId: DATASET_ID,
      title: 'Signal',
    })
    expect(analysis?.config.kind).toBe('analysis')
    expect(analysis?.readOnly).toBe(true)
    const sheet = sheetToRepresentationHandle({ instanceId: INSTANCE_ID, title: 'Grid' })
    expect(sheet?.config.kind).toBe('sheet')
    expect(sheet?.readOnly).toBe(false)
  })

  it('embeds compare views by promoting to ChartSpec — no compare block type', () => {
    const config: ComparativeViewConfig = {
      configVersion: COMPARATIVE_VIEW_CONFIG_VERSION,
      datasetId: DATASET_ID,
      versionId: null,
      viewType: 'time_series',
      timeField: COL_X,
      valueField: COL_Y,
      groupBy: [COL_G],
      facetBy: null,
    }
    expect(validateComparativeViewConfig(config)).toEqual([])
    const promoted = comparativeViewToRepresentationHandle(config, COLUMNS, 'Compare')
    expect(promoted.config.kind).toBe('chart')
    if (promoted.config.kind !== 'chart') throw new Error('unreachable')
    // The promoted spec passes the canonical validator — the existing chart
    // block path (validateBlock + chart adapter) already embeds it.
    expect(validateChartSpec(promoted.config.config)).toEqual([])
    expect(
      validateBlock({
        type: 'chart',
        payload: { spec: promoted.config.config, title: 'Compare' },
      }).ok,
    ).toBe(true)
    expect(promoted.source.datasetId).toBe(DATASET_ID)
  })

  it('marks pinned compare views frozen', () => {
    const config: ComparativeViewConfig = {
      configVersion: COMPARATIVE_VIEW_CONFIG_VERSION,
      datasetId: DATASET_ID,
      versionId: VERSION_ID,
      viewType: 'distribution',
      timeField: null,
      valueField: COL_Y,
      groupBy: [COL_G],
      facetBy: null,
    }
    expect(validateComparativeViewConfig(config)).toEqual([])
    const promoted = comparativeViewToRepresentationHandle(config, COLUMNS)
    expect(promoted.provenance.frozen).toBe(true)
    expect(promoted.source.versionId).toBe(VERSION_ID)
  })
})

describe('representation metadata surface', () => {
  it('serializes kind/source/version/config with no row data', () => {
    const metadata = serializeRepresentationMetadata(chartHandle())
    expect(metadata).toMatchObject({
      kind: 'chart',
      datasetId: DATASET_ID,
      versionId: VERSION_ID,
      configVersion: CHART_SPEC_VERSION,
      frozen: true,
      readOnly: true,
      title: 'Trend',
    })
    expect(metadata.provenanceSummary).toContain(VERSION_ID.slice(0, 8))
    expect(Object.keys(metadata).sort()).toEqual(
      [
        'configVersion',
        'datasetId',
        'frozen',
        'kind',
        'provenanceSummary',
        'readOnly',
        'recordId',
        'title',
        'versionId',
      ].sort(),
    )
  })

  it('stays readable through the existing blocks contract (no new tables)', () => {
    const contract = readFileSync('docs/api/public-api-contract.md', 'utf8')
    const blocksRow = contract
      .split('\n')
      .find((line) => /^\| `blocks`/.test(line))
    expect(blocksRow, 'blocks must stay on the public contract').toBeTruthy()
    expect(blocksRow).toMatch(/projects:read/)
    // Metadata derives from block payloads, so no new public table is needed.
    expect(contract).not.toMatch(/representation_metadata/)
  })
})
