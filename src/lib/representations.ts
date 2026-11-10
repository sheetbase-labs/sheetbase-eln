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

import { z } from 'zod'
import {
  ANALYSIS_DEFINITION_VERSION,
  runAnalysis,
  validateAnalysisDefinition,
} from './analysis-definition'
import type {
  AnalysisBlockDefinition,
  AnalysisDefinition,
  AnalysisError,
  AnalysisResult,
} from './analysis-definition'
import type { FrozenAnalysis } from './analysis-block'
import { frozenAnalysisMethodMismatch } from './analysis-block'
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
  MaterialisedChart,
} from './chart-spec'
import {
  CHART_SPEC_VERSION,
  materialiseChart,
  validateChartSpec,
} from './chart-spec'
import { PLATE_MAP_SPEC_VERSION, validatePlateMapSpec } from './plate-map'
import type { PlateMapSpec, PlateMapSpecError } from './plate-map'
import { sampleSeriesForRender } from './visualisation-pipeline'
import { filterRowsByFlags } from './dataset-flags'
import type { DatasetValueFlag } from './dataset-flags'

// ---------------------------------------------------------------------------
// VIEW-04 — stable embed config, metadata, compare hand-off, export stamps
// ---------------------------------------------------------------------------

import type { FigureProvenanceStamp } from './visualisation-export'
import {
  promoteToChartSpec,
  validateComparativeViewConfig,
} from './comparative-view'
import type { ComparativeViewConfig } from './comparative-view'

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
      config: AnalysisBlockDefinition
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
  rows: Parameters<typeof runAnalysis>[2]
  /** DSET-01.2 — active value flags; flagged values are excluded by default. */
  flags?: DatasetValueFlag[]
}

export type RepresentationMaterialised =
  | { kind: 'chart'; materialised: MaterialisedChart }
  | {
      kind: 'analysis'
      outcome:
        | { ok: true; result: AnalysisResult }
        | { ok: false; error: AnalysisError }
    }
  | { kind: 'plate_map'; errors: PlateMapSpecError[]; wellCount: number }
  | { kind: 'sheet'; instanceId: string }

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
      const { config: spec } = handle.config

      // DSET-01.2 — exclude flagged values the chart uses.
      const usedFields = Object.values(spec.fields).flatMap((binding) =>
        isInput(stringInput, binding?.fieldId) ? [binding.fieldId] : [],
      )

      const rows = filterRowsByFlags(input.rows, input.flags ?? [], usedFields)

      return {
        kind: 'chart',
        materialised: materialiseChart(spec, input.columns, rows),
      }
    }

    case 'analysis': {
      const { config: definition } = handle.config

      return {
        kind: 'analysis',
        outcome: runAnalysis(
          definition,
          input.columns,
          input.rows,
          input.flags ?? [],
        ),
      }
    }

    case 'plate_map': {
      const { config: spec } = handle.config

      return {
        kind: 'plate_map',
        errors: validatePlateMapSpec(spec),
        wellCount: spec.wells.length,
      }
    }

    case 'sheet': {
      const { config } = handle.config

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
      outcome:
        | { ok: true; result: AnalysisResult }
        | { ok: false; error: AnalysisError }
    }
  | { kind: 'plate_map'; errors: PlateMapSpecError[]; wellCount: number }
  | { kind: 'sheet'; instanceId: string }

function isFrozenChart(v: RepresentationFrozenPayload): v is FrozenChart {
  return (
    isInput(objectInput, v) &&
    'data' in v &&
    isInput(objectInput, v.data) &&
    'series' in v.data &&
    Array.isArray(v.data.series)
  )
}

function isFrozenAnalysis(v: RepresentationFrozenPayload): v is FrozenAnalysis {
  return (
    isInput(objectInput, v) &&
    'definition' in v &&
    isInput(objectInput, v.definition)
  )
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
      const { config: spec } = handle.config

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
      if (!isFrozenAnalysis(frozen)) {
        throw new Error(
          'analysis reconstruction requires a FrozenAnalysis payload',
        )
      }

      // R5-STUDIO-01: when the freeze recorded a method version this build
      // cannot reproduce, the numbers are withheld rather than silently
      // recomputed under a method the citation never named.
      const methodMismatch = frozenAnalysisMethodMismatch(frozen)

      if (methodMismatch) {
        return {
          kind: 'analysis',
          outcome: {
            ok: false,
            error: { code: 'method_mismatch', ...methodMismatch },
          },
        }
      }

      if (!input) {
        return {
          kind: 'analysis',
          outcome: { ok: false, error: { code: 'empty_dataset' } },
        }
      }

      return {
        kind: 'analysis',
        outcome: runAnalysis(
          frozen.definition,
          input.columns,
          input.rows,
          input.flags ?? [],
        ),
      }
    }

    case 'plate_map': {
      const { config: spec } = handle.config

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
      const { config } = handle.config

      return { kind: 'sheet', instanceId: config.instanceId }
    }
  }
}

/**
 * Display-only sampling for render. Delegates to `sampleSeriesForRender`:
 * rendered points may be reduced, analysis counts are reported honestly, and
 * analysis inputs are never sampled.
 */
export function sampleRepresentationDisplay(materialised: MaterialisedChart) {
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
  const primary = provenance.at(0)

  const datasetId =
    (isInput(stringInput, primary?.datasetId) && primary.datasetId.length > 0
      ? primary.datasetId
      : null) ??
    input.spec.datasets.at(0)?.datasetId ??
    null

  const singlePin =
    provenance.length === 1 &&
    isInput(stringInput, primary?.datasetVersionId) &&
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

// ---------------------------------------------------------------------------
// Embed-site adapter: plate_map block payload → handle
// ---------------------------------------------------------------------------

/**
 * Build a plate_map handle from a notebook block payload's parsed `spec`.
 * Plates bind no Dataset: the source carries null dataset/version identity
 * and well→record links resolve separately by stable record ID (see
 * `resolveWellSample` in `plate-map.ts`) — rows are never part of the
 * handle. `frozen` marks renders of a pinned revision snapshot: the spec is
 * reconstructed verbatim from `block_snapshot` and no live record reads may
 * run in historical mode.
 */
export function plateMapToRepresentationHandle(input: {
  spec: PlateMapSpec | null
  title?: string
  frozen?: boolean
}): RepresentationHandle | null {
  if (!input.spec) return null

  return createRepresentationHandle({
    source: { datasetId: null, versionId: null },
    config: {
      kind: 'plate_map',
      configVersion: PLATE_MAP_SPEC_VERSION,
      config: input.spec,
    },
    title: input.title,
    frozen: input.frozen ?? false,
  })
}

const stringInput = z.string()
const booleanInput = z.boolean()

const uuidInput = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

const nullableUuidInput = uuidInput.nullable()
const optionalUuidInput = uuidInput.optional()

function isInput<Schema extends z.ZodType, Value>(
  schema: Schema,
  value: Value,
): value is Value & z.infer<Schema> {
  return schema.safeParse(value).success
}

const objectInput = z.custom<object>(
  (value) =>
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Legacy frozen discriminators and source diagnostics recognize native objects and arrays, not only Zod's plain-object representation.
    typeof value === 'object' && value !== null,
)

// Inspect the original envelope rather than parsing away extension keys,
// explicit undefined properties, native objects or legacy source arrays.
const embedInput = z.custom<{
  kind?: unknown
  configVersion?: unknown
  config?: unknown
  source?: unknown
  title?: unknown
  frozen?: unknown
}>((value) => isInput(objectInput, value) && !Array.isArray(value))

const sourceFieldsInput = z.custom<{
  datasetId?: unknown
  versionId?: unknown
  recordId?: unknown
}>((value) => isInput(objectInput, value))

const sourceIdentityInput = z.custom<RepresentationSource>(
  (value) =>
    isInput(sourceFieldsInput, value) &&
    isInput(nullableUuidInput, value.datasetId) &&
    isInput(nullableUuidInput, value.versionId) &&
    isInput(optionalUuidInput, value.recordId),
)

const sheetConfigInput = z.custom<SheetRepresentationConfig>(
  (value) =>
    (isInput(objectInput, value) || isInput(z.function(), value)) &&
    'instanceId' in value &&
    isInput(uuidInput, value.instanceId),
)

const representationConfigInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chart'),
    configVersion: z.literal(CHART_SPEC_VERSION),
    config: z.custom<ChartSpec>(
      (value) => validateChartSpec(value).length === 0,
    ),
  }),
  z.object({
    kind: z.literal('plate_map'),
    configVersion: z.literal(PLATE_MAP_SPEC_VERSION),
    config: z.custom<PlateMapSpec>(
      (value) => validatePlateMapSpec(value).length === 0,
    ),
  }),
  z.object({
    kind: z.literal('analysis'),
    configVersion: z.literal(ANALYSIS_DEFINITION_VERSION),
    config: z.custom<AnalysisBlockDefinition>(
      (value) => validateAnalysisDefinition(value).length === 0,
    ),
  }),
  z.object({
    kind: z.literal('sheet'),
    configVersion: z.literal(SHEET_REPRESENTATION_CONFIG_VERSION),
    config: sheetConfigInput,
  }),
])

/**
 * Validate a representation embed request fail-closed. The payload carries a
 * versioned config only — never rows. Unknown kinds, unknown config versions
 * and configs rejected by their canonical validator all fail; callers must
 * not fall back to a live re-read when this fails.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public raw embed boundary immediately inspects the envelope, then validates identity and the canonical per-kind configuration in diagnostic order.
export function validateRepresentationEmbed(input: unknown) {
  if (!isInput(embedInput, input)) {
    return { ok: false, errors: ['embed must be an object'] }
  }

  const candidate = input
  const kind = candidate.kind

  if (
    kind !== 'chart' &&
    kind !== 'plate_map' &&
    kind !== 'analysis' &&
    kind !== 'sheet'
  ) {
    return {
      ok: false,
      errors: [`unknown representation kind: ${String(kind)}`],
    }
  }

  if (candidate.configVersion !== representationConfigVersion(kind)) {
    return {
      ok: false,
      errors: [
        `${kind} configVersion must be ${representationConfigVersion(kind)} (got ${String(candidate.configVersion)})`,
      ],
    }
  }

  const source = candidate.source
  const sourceErrors: string[] = []

  if (!isInput(sourceFieldsInput, source)) {
    sourceErrors.push('source must be an object')
  } else {
    if (!isInput(nullableUuidInput, source.datasetId)) {
      sourceErrors.push('source.datasetId must be a UUID or null')
    }

    if (!isInput(nullableUuidInput, source.versionId)) {
      sourceErrors.push('source.versionId must be a UUID or null')
    }

    if (!isInput(optionalUuidInput, source.recordId)) {
      sourceErrors.push('source.recordId must be a UUID when present')
    }
  }

  if (sourceErrors.length > 0) return { ok: false, errors: sourceErrors }

  const config = representationConfigInput.safeParse({
    kind,
    configVersion: candidate.configVersion,
    config: candidate.config,
  })

  if (!config.success) {
    const messages = {
      chart: 'chart config failed the ChartSpec validator',
      plate_map: 'plate_map config failed the PlateMapSpec validator',
      analysis: 'analysis config failed the analysis definition validator',
      sheet: 'sheet config.instanceId must be a UUID',
    }

    return { ok: false, errors: [messages[kind]] }
  }

  const identity = sourceIdentityInput.parse(source)

  const typedSource: RepresentationSource = {
    datasetId: identity.datasetId,
    versionId: identity.versionId,
  }

  if (identity.recordId !== undefined) typedSource.recordId = identity.recordId

  const handle = createRepresentationHandle({
    source: typedSource,
    config: config.data,
    title: isInput(stringInput, candidate.title) ? candidate.title : undefined,
    frozen: isInput(booleanInput, candidate.frozen)
      ? candidate.frozen
      : undefined,
  })

  return { ok: true, handle, errors: [] }
}

/**
 * API/SDK-readable representation metadata. Stable IDs and versions only —
 * never row data. Block payloads carrying these handles are already readable
 * through the existing `blocks` resource (`projects:read`); no new tables.
 */
export interface RepresentationMetadata {
  kind: RepresentationKind
  title: string | null
  datasetId: string | null
  versionId: string | null
  recordId: string | null
  configVersion: number
  frozen: boolean
  readOnly: boolean
  provenanceSummary: string
}

export function serializeRepresentationMetadata(
  handle: RepresentationHandle,
): RepresentationMetadata {
  return {
    kind: handle.config.kind,
    title: handle.title ?? null,
    datasetId: handle.source.datasetId,
    versionId: handle.source.versionId,
    recordId: handle.source.recordId ?? null,
    configVersion: handle.config.configVersion,
    frozen: handle.provenance.frozen,
    readOnly: handle.readOnly,
    provenanceSummary: handle.provenance.summary,
  }
}

/** Provenance stamp for a handle's exports at a caller-supplied timestamp. */
export function representationExportStamp(
  handle: RepresentationHandle,
  exportedAt: string,
): FigureProvenanceStamp {
  return {
    kind: handle.config.kind,
    datasetId: handle.source.datasetId,
    versionId: handle.source.versionId,
    configVersion: handle.config.configVersion,
    exportedAt,
  }
}

/**
 * R5-STUDIO-01 — an analysis export stamp that carries the reported method
 * and every check it reported, so an exported result still describes the
 * model it ran. The checks travel as reported: a failing check is exported as
 * failing, never smoothed into a pass.
 */
export function analysisExportStamp(
  handle: RepresentationHandle,
  exportedAt: string,
  result: AnalysisResult,
): FigureProvenanceStamp {
  if (handle.config.kind !== 'analysis')
    throw new Error('analysis export stamp requires an analysis handle')

  return {
    ...representationExportStamp(handle, exportedAt),
    method: {
      id: result.method.id,
      version: result.method.version,
      label: result.method.label,
      runner: result.method.runner,
    },
    checks: result.checks.map((check) => ({
      id: check.id,
      status: check.status,
      detail: check.detail,
    })),
  }
}

// ---------------------------------------------------------------------------
// Embed-site adapters: analysis + sheet block payloads → handle
// ---------------------------------------------------------------------------

/**
 * Build an analysis handle from a notebook block payload's definition. The
 * frozen path re-executes the verbatim `frozen.definition` snapshot, so the
 * embed carries the live definition only for live rendering.
 */
export function analysisToRepresentationHandle(input: {
  definition: AnalysisDefinition | null
  datasetId: string | null
  versionId?: string | null
  title?: string
  frozen?: boolean
}): RepresentationHandle | null {
  if (!input.definition) return null

  return createRepresentationHandle({
    source: {
      datasetId: input.datasetId,
      versionId: input.versionId ?? null,
    },
    config: {
      kind: 'analysis',
      configVersion: ANALYSIS_DEFINITION_VERSION,
      config: input.definition,
    },
    title: input.title,
    frozen: input.frozen ?? input.versionId != null,
  })
}

/**
 * Build a sheet handle from a sheet-instance block's stable instance ID.
 * Sheets stay editable surfaces; the grid owns its state.
 */
export function sheetToRepresentationHandle(input: {
  instanceId: string | null
  title?: string
}): RepresentationHandle | null {
  if (!input.instanceId) return null

  return createRepresentationHandle({
    source: { datasetId: null, versionId: null },
    config: {
      kind: 'sheet',
      configVersion: SHEET_REPRESENTATION_CONFIG_VERSION,
      config: { instanceId: input.instanceId },
    },
    title: input.title,
    frozen: false,
  })
}

/**
 * Compare embed story: a comparative view has no block type of its own — it
 * promotes to a canonical ChartSpec (VIEW-03 hand-off) and embeds as a chart
 * representation through the existing chart path. Throws on an invalid
 * config; the promoted spec passes the canonical ChartSpec validator.
 */
export function comparativeViewToRepresentationHandle(
  config: ComparativeViewConfig,
  columns?: ChartColumn[],
  title?: string,
): RepresentationHandle {
  const errors = validateComparativeViewConfig(config)

  if (errors.length > 0) {
    throw new Error(`Invalid comparative view config: ${errors.join('; ')}`)
  }

  const spec = promoteToChartSpec(config, columns)

  return createRepresentationHandle({
    source: {
      datasetId: config.datasetId,
      versionId: config.versionId ?? null,
    },
    config: {
      kind: 'chart',
      configVersion: CHART_SPEC_VERSION,
      config: spec,
    },
    title: title ?? `${config.viewType} compare`,
    frozen: config.versionId != null,
  })
}
