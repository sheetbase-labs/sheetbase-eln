/**
 * ASSIST-02 — Drafting & Transformation Assistance.
 *
 * Deterministic local proposal builders, grounded in canonical state, with
 * preview-before-commit. Every proposal is inspectable, clearly marked as
 * generated (PRODUCT.md:91 — distinguishable, reviewable, attributable),
 * and accepted only through the ordinary canonical operation:
 *
 * - `import_mapping` suggestions extend the existing exact-match suggester
 *   (`suggestImportMappings`) with confidence + reason + preview; Accept
 *   applies the mapping through the ordinary `mapImportSheet` /
 *   `validateAndCommitImport` path the import wizard already commits
 *   through.
 * - `chart_config` proposals target the chart configurator: a valid
 *   `ChartSpec` per the existing `validateChartSpec` validators, previewed
 *   in the renderer, loaded via the configurator's `onSpecChange` on
 *   Accept.
 * Discard leaves zero state: builders are pure, the panel never mutates,
 * and the accept helpers are the only mutation seam (called by the host,
 * never by the proposal itself).
 */

import type { AssistCitation } from './assist-explain'
import {
  CHART_SPEC_VERSION,
  CHART_TYPES_NULL_X,
  CHART_TYPES_REQUIRING_X,
  validateChartSpec,
} from './chart-spec'
import type { ChartSpec, ChartType } from './chart-spec'
import type { ImportColumnMapping, ImportTargetField } from './import-mapping'

/**
 * Badge rendered beside every proposal preview. Assistance is
 * distinguishable from canonical state: grounded proposal first, model
 * phrasing clearly marked, never authoritative.
 */
export const GENERATED_DRAFT_BADGE =
  'Generated draft — review before accepting.' as const

export interface AssistDraftMarking {
  badge: typeof GENERATED_DRAFT_BADGE
  /** Always true: proposals are assistance, accepted only by human review. */
  assistance: true
}

interface AssistDraftBase {
  title: string
  /** Deterministic summary of what the draft proposes, in workspace terms. */
  summary: string
  /** Every cited source, in claim order. */
  citations: AssistCitation[]
  /** Which canonical state the proposal was assembled from. */
  groundedFrom: string
  marking: AssistDraftMarking
}

export type ImportMappingConfidence = 'exact' | 'close' | 'none'

export interface ImportMappingSuggestion {
  source: string
  mapping: ImportColumnMapping
  confidence: ImportMappingConfidence
  /** Why this target was suggested (or why the column is left ignored). */
  reason: string
}

/** Structured field-mapping suggestions for an import, with preview. */
export interface AssistMappingProposal extends AssistDraftBase {
  kind: 'import_mapping'
  headers: string[]
  suggestions: ImportMappingSuggestion[]
  mappedCount: number
  ignoredCount: number
}

/** A chart-configuration proposal targeting the configurator. */
export interface AssistChartProposal extends AssistDraftBase {
  kind: 'chart_config'
  spec: ChartSpec
  /** One deterministic rationale line per choice (type, x, y). */
  rationale: string[]
}

export type AssistDraftProposal = AssistMappingProposal | AssistChartProposal

const MARKING: AssistDraftMarking = {
  badge: GENERATED_DRAFT_BADGE,
  assistance: true,
}

// ---------------------------------------------------------------------------
// (b) Structured transformation / field-mapping suggestions for imports.
// ---------------------------------------------------------------------------

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

function normalisedAlnum(value: string): string {
  return normalise(value).replace(/[^a-z0-9]/g, '')
}

function exactTarget(
  source: string,
  fields: ImportTargetField[],
): ImportTargetField | null {
  const wanted = normalise(source)
  return (
    fields.find((field) =>
      [field.label, field.key, field.id]
        .filter(Boolean)
        .map((value) => normalise(String(value)))
        .includes(wanted),
    ) ?? null
  )
}

function closeTarget(
  source: string,
  fields: ImportTargetField[],
): { field: ImportTargetField; reason: string } | null {
  const flat = normalisedAlnum(source)
  if (flat.length === 0) return null
  for (const field of fields) {
    const labels = [field.label, field.key, field.id]
      .filter(Boolean)
      .map((value) => normalisedAlnum(String(value)))
    if (labels.includes(flat)) {
      return {
        field,
        reason: `Headers differ only by separators or case ('${source}' ≈ '${field.label}').`,
      }
    }
  }
  // Token containment for renamed-but-recognisable headers (e.g.
  // "sample_id" vs "Sample"). Tokens shorter than 3 chars never match so
  // single-letter columns do not fuzzy-bind to unrelated fields.
  for (const field of fields) {
    const labelTokens = normalise(String(field.label))
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 3)
    const sourceTokens = normalise(source)
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 3)
    const hit = labelTokens.find(
      (token) =>
        sourceTokens.includes(token) ||
        sourceTokens.some(
          (candidate) => candidate.includes(token) || token.includes(candidate),
        ),
    )
    if (hit) {
      return {
        field,
        reason: `Header shares the token '${hit}' with '${field.label}' — confirm before accepting.`,
      }
    }
  }
  return null
}

/**
 * Suggest field mappings for import headers. Extends the existing
 * exact-match suggester: exact matches keep confidence `exact`; headers
 * differing only by separators/case or sharing a recognisable token are
 * offered as `close` with a reason; everything else is `ignore` with
 * confidence `none`. Deterministic and local — no model call. The caller
 * commits through the ordinary import path (`mapImportSheet` +
 * `validateAndCommitImport`); this function never writes.
 */
export function suggestMappingProposal(
  headers: string[],
  fields: ImportTargetField[],
): AssistMappingProposal {
  const suggestions: ImportMappingSuggestion[] = headers.map((source) => {
    const exact = exactTarget(source, fields)
    if (exact) {
      return {
        source,
        mapping: { source, kind: 'field', field: exact },
        confidence: 'exact' as const,
        reason: `Exact match on '${exact.label}' (label, key, or id, case-insensitive).`,
      }
    }
    const close = closeTarget(source, fields)
    if (close) {
      return {
        source,
        mapping: { source, kind: 'field', field: close.field },
        confidence: 'close' as const,
        reason: close.reason,
      }
    }
    return {
      source,
      mapping: { source, kind: 'ignore' },
      confidence: 'none' as const,
      reason:
        'No matching target field — the column will be ignored unless mapped by hand.',
    }
  })
  const mappedCount = suggestions.filter(
    (suggestion) => suggestion.mapping.kind === 'field',
  ).length
  return {
    kind: 'import_mapping',
    title: `Suggested field mapping for ${headers.length} column${headers.length === 1 ? '' : 's'}`,
    summary:
      `${mappedCount} of ${headers.length} columns map to target fields ` +
      `(${headers.length - mappedCount} ignored). ` +
      'Review each suggestion, then apply through the ordinary import commit. Nothing is written until Accept.',
    headers: [...headers],
    suggestions,
    mappedCount,
    ignoredCount: headers.length - mappedCount,
    citations: [
      {
        label: 'Import target schema',
        detail: `target fields ${fields.map((field) => `'${field.label}'`).join(', ') || 'none'}`,
      },
    ],
    groundedFrom:
      'import-mapping suggester (exact label/key/id match) + deterministic close-match over the pinned target schema',
    marking: MARKING,
  }
}

/** Project a mapping proposal back to the ordinary mapping the import path commits. */
export function applyMappingProposal(
  proposal: AssistMappingProposal,
): ImportColumnMapping[] {
  return proposal.suggestions.map((suggestion) => suggestion.mapping)
}

// ---------------------------------------------------------------------------
// (c) Chart / analysis configuration proposals targeting the configurator.
// ---------------------------------------------------------------------------

export interface AssistChartField {
  fieldId: string
  label: string
  logicalType: string
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function isNumericType(logicalType: string): boolean {
  return ['number', 'numeric', 'integer', 'float', 'decimal'].includes(
    logicalType.trim().toLowerCase(),
  )
}

/**
 * Propose a valid `ChartSpec` for the given dataset fields. Deterministic
 * rules over canonical schema metadata — no model call:
 *
 * - one usable field → `histogram` of that field (x is null per validator);
 * - categorical/datetime x + numeric y → `bar`;
 * - two numerics → `scatter`;
 * - otherwise → `summary` of the first field.
 *
 * The returned spec always passes `validateChartSpec`; null is returned
 * when no valid spec can be grounded (bad dataset id, no fields).
 * Accept loads the spec through the configurator's `onSpecChange` and the
 * renderer previews it — no new mutation path.
 */
export function proposeChartSpec(input: {
  datasetId: string
  fields: AssistChartField[]
  preferredType?: ChartType
}): AssistChartProposal | null {
  if (!isUuid(input.datasetId)) return null
  // Field bindings resolve by stable UUID (validateChartSpec rejects
  // anything else), so only UUID fields can ground a valid proposal.
  const fields = input.fields.filter((field) => isUuid(field.fieldId))
  if (fields.length === 0) return null
  const first = fields[0]
  const numerics = fields.filter((field) => isNumericType(field.logicalType))
  const categories = fields.filter((field) => !isNumericType(field.logicalType))
  const y = numerics[0] ?? first
  const x = categories.find((field) => field.fieldId !== y.fieldId) ?? null

  // Explicit requests bind by the validator's x rules: null-x types drop
  // x, x-requiring types fail closed without a categorical field.
  if (input.preferredType !== undefined) {
    const type = input.preferredType
    const needsX = (CHART_TYPES_REQUIRING_X as readonly string[]).includes(type)
    const nullsX = (CHART_TYPES_NULL_X as readonly string[]).includes(type)
    if (needsX && !x) return null
    const boundX = nullsX ? null : (x ?? secondNumeric(numerics, y))
    if (!nullsX && !boundX) return null
    return buildChartProposal(
      input.datasetId,
      type,
      boundX,
      y,
      [
        `Type ${type}: requested explicitly; bindings follow the validator's x/y rules.`,
        boundX
          ? `X binds '${boundX.label}' (${boundX.fieldId}); y binds '${y.label}' (${y.fieldId}).`
          : `Y binds '${y.label}' (${y.fieldId}); x stays null for ${type} charts.`,
      ],
      fields,
    )
  }
  // Automatic rules, most-structured plot first: a categorical x against a
  // numeric y plots as bars; two numerics plot pairwise; a lone measured
  // field summarises as a distribution; otherwise the first field is
  // summarised.
  if (x && isNumericType(y.logicalType)) {
    return buildChartProposal(
      input.datasetId,
      'bar',
      x,
      y,
      [
        `Type bar: categorical '${x.label}' against numeric '${y.label}'.`,
        `X binds '${x.label}' (${x.fieldId}); y binds '${y.label}' (${y.fieldId}).`,
      ],
      fields,
    )
  }
  const second = secondNumeric(numerics, y)
  if (second) {
    return buildChartProposal(
      input.datasetId,
      'scatter',
      second,
      y,
      [
        `Type scatter: two measured fields ('${y.label}' vs '${second.label}') plot pairwise.`,
        `X binds '${second.label}' (${second.fieldId}); y binds '${y.label}' (${y.fieldId}).`,
      ],
      fields,
    )
  }
  if (isNumericType(y.logicalType)) {
    return buildChartProposal(
      input.datasetId,
      'histogram',
      null,
      y,
      [
        `Type histogram: a single measured field ('${y.label}') is best summarised as a distribution.`,
        `Y binds '${y.label}' (${y.fieldId}); x stays null because histogram charts reject an x mapping.`,
      ],
      fields,
    )
  }
  return buildChartProposal(
    input.datasetId,
    'summary',
    null,
    y,
    [
      `Type summary: no plottable numeric pair, so the first field ('${y.label}') is summarised.`,
      `Y binds '${y.label}' (${y.fieldId}); x stays null.`,
    ],
    fields,
  )
}

function secondNumeric(
  numerics: AssistChartField[],
  y: AssistChartField,
): AssistChartField | null {
  return numerics.find((field) => field.fieldId !== y.fieldId) ?? null
}

function buildChartProposal(
  datasetId: string,
  type: ChartType,
  x: AssistChartField | null,
  y: AssistChartField,
  rationale: string[],
  fields: AssistChartField[],
): AssistChartProposal | null {
  const spec: ChartSpec = {
    specVersion: CHART_SPEC_VERSION,
    type,
    datasets: [{ datasetId }],
    fields: {
      x: x ? { fieldId: x.fieldId } : null,
      y: { fieldId: y.fieldId },
      series: null,
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    display: {
      axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
      series: [],
    },
    overlays: { errorBars: null },
  }
  if (validateChartSpec(spec).length > 0) return null
  return {
    kind: 'chart_config',
    title: `Proposed ${type} chart`,
    summary:
      `Loads a ${type} spec into the chart configurator (x: ` +
      `${x ? `'${x.label}'` : 'none'}, y: '${y.label}'). ` +
      'Preview in the renderer, then apply. Nothing is written until Accept.',
    spec,
    rationale,
    citations: [
      {
        label: 'Dataset schema fields',
        detail: `dataset ${datasetId} · fields ${fields.map((field) => `'${field.label}' (${field.logicalType})`).join(', ')}`,
      },
      {
        label: 'Chart spec validator',
        detail:
          'chart-spec validation kernel (validateChartSpec, spec v1) · proposed spec passes with zero errors',
      },
    ],
    groundedFrom:
      'canonical dataset schema fields + chart-spec validators (deterministic type/binding rules, no model claims)',
    marking: MARKING,
  }
}
