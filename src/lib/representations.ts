/**
 * VIEW-01 — Generic representation contract over canonical sources.
 *
 * A representation is a named, versioned *view configuration* over canonical
 * Sheet/Dataset/Record state. It carries stable-ID source identity plus the
 * configuration object — never a copy of the source rows. Rows are supplied
 * by the caller at materialisation time (a live RPC read or pinned Dataset
 * Version rows) and are never stored on the handle.
 *
 * Thin dispatch, no parallel model: `materialiseRepresentation` and
 * `reconstructFrozenRepresentation` delegate to the existing per-kind
 * materialisers (`materialiseChart`, `runAnalysis`, `validatePlateMapSpec`,
 * `materialiseFrozenChart` / `reconstructFrozenVisualisation`). ChartSpec
 * remains canonical for visualisation; this module adds no second authority.
 *
 * Permissions: this framework performs NO permission checks itself. Row
 * reads stay under RLS and the existing RPC authority (dataset RPCs,
 * freeze/unfreeze SECURITY DEFINER functions); a handle holding a datasetId
 * grants nothing. Provenance/version behaviour: the framework carries the
 * pinned Dataset Version id (`source.versionId`) through to frozen
 * reconstruction and exposes source identity for provenance display.
 *
 * Display sampling boundary: reduction for render (e.g.
 * `sampleRepresentationDisplay`) is display-only and reports its counts; it
 * must never silently alter analysis semantics — analysis inputs always see
 * every observation.
 *
 * Read-only vs editable is an explicit flag on the handle, derived from the
 * kind and consumed by renderers: only `sheet` is editable;
 * `chart` / `plate_map` / `analysis` are read-only.
 */

import {
  ANALYSIS_DEFINITION_VERSION,
  runAnalysis,
} from './analysis-definition'
import type {
  AnalysisDefinition,
  AnalysisError,
  AnalysisResult,
} from './analysis-definition'
import type { FrozenAnalysis } from './analysis-block'
import {
  materialiseFrozenChart,
  materialiseFrozenFacets,
  reconstructFrozenVisualisation,
} from './chart-data'
import type {
  ChartColumn,
  ChartSpec,
  FacetedChart,
  FrozenChart,
} from './chart-spec'
import { CHART_SPEC_VERSION, materialiseChart } from './chart-spec'
import type { MaterialisedChart } from './chart-spec'
import { PLATE_MAP_SPEC_VERSION, validatePlateMapSpec } from './plate-map'
import type { PlateMapSpec, PlateMapSpecError } from './plate-map'
import { sampleSeriesForRender } from './visualisation-pipeline'

// ---------------------------------------------------------------------------
// Kinds, sources, configs, handles
// ---------------------------------------------------------------------------

export const REPRESENTATION_KINDS = [
  'chart',
  'plate_map',
  'analysis',
  'sheet',
] as const
export type RepresentationKind = (typeof REPRESENTATION_KINDS)[number]

/**
 * Identity of the canonical source a representation reads. Stable IDs only —
 * never copied rows. `datasetId` is null for kinds with no Dataset binding
 * (plate_map, sheet); `versionId` pins the immutable Dataset Version for
 * frozen evidence (null = live); `recordId` carries a canonical Record
 * identity where the kind has one (plate sample link).
 */
export interface RepresentationSource {
  datasetId: string | null
  versionId: string | null
  recordId?: string
}

/** Sheet configuration: the Sheet Instance stable ID. The grid owns its state. */
export interface SheetRepresentationConfig {
  instanceId: string
}

/** Version of the sheet representation envelope (no canonical spec module). */
export const SHEET_REPRESENTATION_CONFIG_VERSION = 1 as const

/**
 * Versioned per-kind configuration. `configVersion` must equal the canonical
 * version of the wrapped spec; `createRepresentationHandle` rejects anything
 * else fail-closed.
 */
export type RepresentationConfig =
  | {
      kind: 'chart'
      configVersion: typeof CHART_SPEC_VERSION
      config: ChartSpec
    }
  | {
      kind: 'plate_map'
      configVersion: typeof PLATE_MAP_SPEC_VERSION
      config: PlateMapSpec
    }
  | {
      kind: 'analysis'
      configVersion: typeof ANALYSIS_DEFINITION_VERSION
      config: AnalysisDefinition
    }
  | {
      kind: 'sheet'
      configVersion: typeof SHEET_REPRESENTATION_CONFIG_VERSION
      config: SheetRepresentationConfig
    }

/** Provenance summary for display: source identity plus frozen-vs-live. */
export interface RepresentationProvenance {
  datasetId: string | null
  versionId: string | null
  recordId?: string
  frozen: boolean
  summary: string
}

/**
 * The representation envelope: source identity + versioned config + an
 * explicit read-only flag + a provenance summary. Renderers consume
 * `readOnly` (editable only for `sheet`); permission enforcement stays with
 * RLS/RPCs.
 */
export interface RepresentationHandle {
  source: RepresentationSource
  config: RepresentationConfig
  readOnly: boolean
  provenance: RepresentationProvenance
  title?: string
}

/** Canonical config version per kind. */
export function representationConfigVersion(kind: RepresentationKind): number {
  switch (kind) {
    case 'chart':
      return CHART_SPEC_VERSION
    case 'plate_map':
      return PLATE_MAP_SPEC_VERSION
    case 'analysis':
      return ANALYSIS_DEFINITION_VERSION
    case 'sheet':
      return SHEET_REPRESENTATION_CONFIG_VERSION
  }
}

/**
 * Read-only boundary per kind. Only sheets are editable surfaces;
 * charts, plate maps and analyses render canonical state read-only.
 */
export function representationReadOnly(kind: RepresentationKind): boolean {
  return kind !== 'sheet'
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function describeProvenance(
  kind: RepresentationKind,
  source: RepresentationSource,
  config: RepresentationConfig,
  frozen: boolean,
): string {
  const parts: string[] = []
  if (source.datasetId) parts.push(`Dataset ${shortId(source.datasetId)}`)
  if (source.versionId) parts.push(`Version ${shortId(source.versionId)}`)
  else if (source.datasetId) parts.push(frozen ? 'snapshot' : 'live')
  if (source.recordId) parts.push(`Record ${shortId(source.recordId)}`)
  if (parts.length > 0) return parts.join(' · ')
  // Kinds with no dataset/record binding still need an identity line.
  if (kind === 'sheet' && config.kind === 'sheet')
    return `Sheet instance ${shortId(config.config.instanceId)}`
  if (kind === 'plate_map') return 'Plate map'
  return kind
}

/**
 * Build a handle. Derives `readOnly` from the kind (not caller-overridable:
 * a chart must never be marked editable) and rejects a stale `configVersion`
 * fail-closed. The caller supplies source identity only — rows are never
 * part of the handle. `frozen` defaults to pin presence; embed sites pass it
 * explicitly when a frozen snapshot exists without a Dataset Version pin
 * (legacy snapshots replay stored series rather than pinned rows).
 */
export function createRepresentationHandle(input: {
  source: RepresentationSource
  config: RepresentationConfig
  title?: string
  frozen?: boolean
}): RepresentationHandle {
  const kind = input.config.kind
  const expected = representationConfigVersion(kind)
  if (input.config.configVersion !== expected) {
    throw new Error(
      `${kind} configVersion must be ${expected} (got ${String(input.config.configVersion)})`,
    )
  }
  const readOnly = representationReadOnly(kind)
  const frozen = input.frozen ?? input.source.versionId != null
  return {
    source: { ...input.source },
    config: input.config,
    readOnly,
    provenance: {
      datasetId: input.source.datasetId,
      versionId: input.source.versionId,
      recordId: input.source.recordId,
      frozen,
      summary: describeProvenance(kind, input.source, input.config, frozen),
    },
    title: input.title,
  }
}

/** The pinned Dataset Version id, or null for live representations. */
export function pinnedVersionId(handle: RepresentationHandle): string | null {
  return handle.source.versionId
}
/** True when the handle renders frozen evidence (pinned or legacy snapshot). */
export function isFrozenRepresentation(handle: RepresentationHandle): boolean {
  return handle.provenance.frozen
}

/** Source identity for provenance display (stable IDs, no rows). */
export function representationSourceIdentity(
  handle: RepresentationHandle,
): RepresentationSource {
  return { ...handle.source }
}

// ---------------------------------------------------------------------------
// Materialisation — thin dispatch over the existing kind materialisers
// ---------------------------------------------------------------------------

/**
 * Caller-supplied canonical rows plus the column metadata the materialisers
 * resolve stable fieldIds against. Live callers read these via the dataset
 * RPCs; frozen callers read the pinned Version's rows. Never stored.
 */
export interface RepresentationTableInput {
  columns: ChartColumn[]
  rows: Record<string, unknown>[]
}

export type RepresentationMaterialised =
  | { kind: 'chart'; materialised: MaterialisedChart }
  | {
      kind: 'analysis'
      outcome: { ok: true; result: AnalysisResult } | { ok: false; error: AnalysisError }
    }
  | { kind: 'plate_map'; errors: PlateMapSpecError[]; wellCount: number }
  | { kind: 'sheet'; instanceId: string }

function requireConfigKind<K extends RepresentationConfig['kind']>(
  handle: RepresentationHandle,
  kind: K,
): Extract<RepresentationConfig, { kind: K }> {
  if (handle.config.kind !== kind) {
    throw new Error(
      `handle kind mismatch: expected ${kind} (got ${handle.config.kind})`,
    )
  }
  return handle.config as Extract<RepresentationConfig, { kind: K }>
}

/**
 * Materialise a live representation from caller-supplied canonical rows.
 * Delegates to the existing kind materialisers; adds no computation of its
 * own. Plate layouts are self-contained (rows ignored — linked sample rows
 * resolve separately for display); sheet identity passes through (the
 * editable grid owns its state, rows ignored).
 */
export function materialiseRepresentation(
  handle: RepresentationHandle,
  input: RepresentationTableInput,
): RepresentationMaterialised {
  switch (handle.config.kind) {
    case 'chart': {
      const { config: spec } = requireConfigKind(handle, 'chart')
      return {
        kind: 'chart',
        materialised: materialiseChart(spec, input.columns, input.rows),
      }
    }
    case 'analysis': {
      const { config: definition } = requireConfigKind(handle, 'analysis')
      return {
        kind: 'analysis',
        outcome: runAnalysis(definition, input.columns, input.rows),
      }
    }
    case 'plate_map': {
      const { config: spec } = requireConfigKind(handle, 'plate_map')
      return {
        kind: 'plate_map',
        errors: validatePlateMapSpec(spec),
        wellCount: spec.wells.length,
      }
    }
    case 'sheet': {
      const { config } = requireConfigKind(handle, 'sheet')
      return { kind: 'sheet', instanceId: config.instanceId }
    }
  }
}

// ---------------------------------------------------------------------------
// Frozen reconstruction — pinned Version rows through the frozen paths
// ---------------------------------------------------------------------------

/** Frozen payload per kind. Plate maps and sheets have no frozen payload. */
export type RepresentationFrozenPayload = FrozenChart | FrozenAnalysis | null

export type RepresentationFrozenResult =
  | {
      kind: 'chart'
      materialised: MaterialisedChart
      facets: { panels: FacetedChart[]; total: number } | null
    }
  | {
      kind: 'analysis'
      outcome: { ok: true; result: AnalysisResult } | { ok: false; error: AnalysisError }
    }
  | { kind: 'plate_map'; errors: PlateMapSpecError[]; wellCount: number }
  | { kind: 'sheet'; instanceId: string }

function isFrozenChart(v: RepresentationFrozenPayload): v is FrozenChart {
  if (typeof v !== 'object' || v === null) return false
  const data = (v as unknown as Record<string, unknown>).data
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as Record<string, unknown>).series)
  )
}

function isFrozenAnalysis(v: RepresentationFrozenPayload): v is FrozenAnalysis {
  if (typeof v !== 'object' || v === null) return false
  const definition = (v as unknown as Record<string, unknown>).definition
  return typeof definition === 'object' && definition !== null
}
/**
 * Reconstruct frozen evidence. The pinned Version id travels on
 * `handle.source.versionId`; the pinned *rows* arrive via `input` (read from
 * the pinned Version — `fetchFrozenAnalysisRows` / the frozen chart pinned
 * rows path). Chart rematerialises through `reconstructFrozenVisualisation`
 * and falls back to replaying the stored snapshot when no rows are supplied
 * (legacy snapshots without a Dataset Version). Analysis re-executes the
 * verbatim `frozen.definition` snapshot — later edits to the saved
 * definition never change frozen evidence. Plate/sheet have no frozen path
 * and return the live-equivalent identity.
 */
export function reconstructFrozenRepresentation(
  handle: RepresentationHandle,
  frozen: RepresentationFrozenPayload,
  input?: RepresentationTableInput,
): RepresentationFrozenResult {
  switch (handle.config.kind) {
    case 'chart': {
      const { config: spec } = requireConfigKind(handle, 'chart')
      if (!isFrozenChart(frozen)) {
        throw new Error('chart reconstruction requires a FrozenChart payload')
      }
      if (input) {
        const { chart, facets } = reconstructFrozenVisualisation({
          spec,
          frozen,
          rows: input.rows,
        })
        return { kind: 'chart', materialised: chart, facets }
      }
      return {
        kind: 'chart',
        materialised: materialiseFrozenChart(frozen),
        facets: materialiseFrozenFacets(frozen),
      }
    }
    case 'analysis': {
      requireConfigKind(handle, 'analysis')
      if (!isFrozenAnalysis(frozen)) {
        throw new Error('analysis reconstruction requires a FrozenAnalysis payload')
      }
      if (!input) {
        return { kind: 'analysis', outcome: { ok: false, error: { code: 'empty_dataset' } } }
      }
      return {
        kind: 'analysis',
        outcome: runAnalysis(frozen.definition, input.columns, input.rows),
      }
    }
    case 'plate_map': {
      const { config: spec } = requireConfigKind(handle, 'plate_map')
      if (frozen !== null) {
        throw new Error('plate_map has no frozen payload')
      }
      return {
        kind: 'plate_map',
        errors: validatePlateMapSpec(spec),
        wellCount: spec.wells.length,
      }
    }
    case 'sheet': {
      const { config } = requireConfigKind(handle, 'sheet')
      return { kind: 'sheet', instanceId: config.instanceId }
    }
  }
}

/**
 * Display-only sampling for render. Delegates to `sampleSeriesForRender`:
 * rendered points may be reduced, analysis counts are reported honestly, and
 * analysis inputs are never sampled.
 */
export function sampleRepresentationDisplay(materialised: MaterialisedChart): {
  series: MaterialisedChart['series']
  sampling: MaterialisedChart['sampling']
} {
  return sampleSeriesForRender(materialised.series)
}
// Embed-site adapter: chart block payload → handle
// ---------------------------------------------------------------------------

/**
 * Build a chart handle from a notebook block payload's parsed `spec` +
 * `frozen`. Returns null when there is no spec (legacy frozen snapshot
 * without one) — those render through the legacy path with no shared frame.
 * Source identity prefers the frozen pin (immutable) over the live spec.
 * The handle carries at most one pinned Version: multi-source frozen charts
 * keep `versionId` null (per-source pins stay on their own links) so the
 * frame never shows a misleading single-version subtitle.
 */
export function chartToRepresentationHandle(input: {
  spec: ChartSpec | null
  frozen: FrozenChart | null | undefined
  title?: string
}): RepresentationHandle | null {
  if (!input.spec) return null
  const provenance = input.frozen?.datasetProvenance ?? []
  const primary = provenance[0]
  const datasetId =
    (typeof primary?.datasetId === 'string' && primary.datasetId.length > 0
      ? primary.datasetId
      : null) ??
    input.spec.datasets[0]?.datasetId ??
    null
  const singlePin =
    provenance.length === 1 &&
    typeof primary?.datasetVersionId === 'string' &&
    primary.datasetVersionId.length > 0
      ? primary.datasetVersionId
      : null
  return createRepresentationHandle({
    source: { datasetId, versionId: singlePin },
    config: {
      kind: 'chart',
      configVersion: CHART_SPEC_VERSION,
      config: input.spec,
    },
    title: input.title,
    frozen: input.frozen != null,
  })
}
