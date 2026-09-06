/**
 * REUSE-01: reusable-structure discovery helpers.
 *
 * Both catalogue systems (protocol-record templates and versioned
 * CORE-06 definitions/templates) are filtered and previewed from stable
 * metadata that already exists — record tags/status/owner/kind for
 * protocol templates, lifecycle + configuration for versioned objects.
 * Nothing here infers purpose from free text: the purpose facet options
 * are exactly the tag vocabulary already in use on the listed templates.
 *
 * Reuse never implies shared mutable state: these helpers are read-only
 * summaries over catalogue entries. Instantiation still pins immutable
 * snapshots (protocol records) or explicit versions (CORE-06).
 */
import type { NotebookRecord } from './notebook-data'
import type { NotebookTemplateConfiguration } from './notebook-template'
import type { SheetDefinitionConfiguration } from './sheet-definition'

// ---------------------------------------------------------------------------
// Purpose facet — derived from the tag vocabulary already in use
// ---------------------------------------------------------------------------

export interface PurposeFacetOption {
  tag: string
  count: number
}

/**
 * Derive purpose facet options from the tags present on the listed
 * templates, most-used first. Tags are author-assigned stable metadata,
 * so the facet vocabulary is whatever the workspace already uses —
 * no free-text inference.
 */
export function derivePurposeFacets(
  templates: ReadonlyArray<Pick<NotebookRecord, 'tags'>>,
): PurposeFacetOption[] {
  const counts = new Map<string, number>()
  for (const template of templates) {
    for (const tag of new Set(template.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** A template matches the purpose facet when no purpose is selected or it carries the tag. */
export function matchesPurposeFacet(
  tags: ReadonlyArray<string>,
  purpose: string,
): boolean {
  if (purpose === 'all') return true
  return tags.includes(purpose)
}

// ---------------------------------------------------------------------------
// Protocol template lifecycle — status plus archived state
// ---------------------------------------------------------------------------

export const PROTOCOL_LIFECYCLE_STATES = [
  'draft',
  'under_review',
  'active',
  'archived',
] as const

export type ProtocolLifecycleState = (typeof PROTOCOL_LIFECYCLE_STATES)[number]

export const PROTOCOL_LIFECYCLE_LABEL: Record<ProtocolLifecycleState, string> =
  {
    draft: 'Draft',
    under_review: 'Under review',
    active: 'Active',
    archived: 'Archived',
  }

/**
 * Effective lifecycle state: an archived template reads as archived
 * whatever its status was, matching the "archived cannot be instantiated"
 * rule in `isInstantiable`.
 */
export function protocolLifecycleState(
  template: Pick<NotebookRecord, 'status' | 'archivedAt'>,
): ProtocolLifecycleState {
  if (template.archivedAt) return 'archived'
  if (template.status === 'under_review') return 'under_review'
  if (template.status === 'active') return 'active'
  return 'draft'
}

export function matchesProtocolLifecycle(
  template: Pick<NotebookRecord, 'status' | 'archivedAt'>,
  filter: 'all' | ProtocolLifecycleState,
): boolean {
  if (filter === 'all') return true
  return protocolLifecycleState(template) === filter
}

// ---------------------------------------------------------------------------
// Versioned lifecycle badges — one mapping shared by notebook templates,
// sheet definitions, and the Configure catalogue lists
// ---------------------------------------------------------------------------

export type ReuseBadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'violet'

/** Version lifecycles: published is ready, draft is neutral, retired warns. */
export function versionLifecycleBadgeVariant(
  lifecycle: string,
): ReuseBadgeVariant {
  if (lifecycle === 'published') return 'success'
  if (lifecycle === 'retired') return 'warning'
  return 'outline'
}

/** Parent lifecycles: active is ready, retired warns. */
export function parentLifecycleBadgeVariant(
  lifecycle: string,
): ReuseBadgeVariant {
  if (lifecycle === 'active') return 'success'
  if (lifecycle === 'retired') return 'warning'
  return 'outline'
}

// ---------------------------------------------------------------------------
// Notebook template requirement previews — parameters + placements
// ---------------------------------------------------------------------------

export interface NotebookTemplateRequiredParameter {
  id: string
  key: string
  label: string
  /** Human-readable kind, e.g. "scalar · integer" or "record · sample". */
  detail: string
  hasDefault: boolean
}

export interface NotebookTemplateRequirementSummary {
  parameterCount: number
  requiredCount: number
  optionalCount: number
  /** Required parameters in configuration order: what instantiation must collect. */
  requiredParameters: NotebookTemplateRequiredParameter[]
  placements: {
    total: number
    narrative: number
    sheet: number
    placeholder: number
  }
  /** Template parameter ids wired into sheet placements via parameterMappings. */
  mappedTemplateParameterIds: string[]
}

export function parameterKindDetail(type: {
  kind: string
  valueType?: string
  modelKey?: string
  contract?: { mode?: string }
}): string {
  if (type.kind === 'scalar') return `scalar · ${type.valueType ?? 'value'}`
  if (type.kind === 'record') return `record · ${type.modelKey ?? 'record'}`
  if (type.kind === 'dataset' || type.kind === 'dataset-version') {
    const mode =
      type.contract && typeof type.contract.mode === 'string'
        ? ` · ${type.contract.mode}`
        : ''
    return `${type.kind}${mode}`
  }
  return type.kind
}

/**
 * Summarise what instantiating a notebook template version needs, reusing
 * the configuration validation contract: `parameters` (required vs
 * optional, mirroring `buildParameterInputs` which throws for a missing
 * required value) and `placements` (including `parameterMappings` wiring
 * validated by the configuration schema).
 */
export function summarizeNotebookTemplateRequirements(
  configuration: NotebookTemplateConfiguration,
): NotebookTemplateRequirementSummary {
  const requiredParameters = configuration.parameters
    .filter((parameter) => parameter.required)
    .map((parameter) => ({
      id: parameter.id,
      key: parameter.key,
      label: parameter.label,
      detail: parameterKindDetail(
        parameter.type as {
          kind: string
          valueType?: string
          modelKey?: string
          contract?: { mode?: string }
        },
      ),
      hasDefault: parameter.defaultValue !== undefined,
    }))
  let narrative = 0
  let sheet = 0
  let placeholder = 0
  const mapped = new Set<string>()
  for (const placement of configuration.placements) {
    if (placement.kind === 'narrative') narrative += 1
    else if (placement.kind === 'sheet') {
      sheet += 1
      for (const mapping of placement.parameterMappings) {
        mapped.add(mapping.templateParameterId)
      }
    } else placeholder += 1
  }
  return {
    parameterCount: configuration.parameters.length,
    requiredCount: requiredParameters.length,
    optionalCount: configuration.parameters.length - requiredParameters.length,
    requiredParameters,
    placements: {
      total: configuration.placements.length,
      narrative,
      sheet,
      placeholder,
    },
    mappedTemplateParameterIds: [...mapped],
  }
}

function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

/** One-line catalogue preview, e.g. "2 required · 1 optional · 3 placements". */
export function notebookTemplateNeedsLine(
  summary: Pick<
    NotebookTemplateRequirementSummary,
    'parameterCount' | 'requiredCount' | 'optionalCount' | 'placements'
  >,
): string {
  const parameterPart =
    summary.parameterCount === 0
      ? 'No parameters'
      : [
          summary.requiredCount > 0
            ? pluralise(summary.requiredCount, 'required', 'required')
            : null,
          summary.optionalCount > 0
            ? pluralise(summary.optionalCount, 'optional', 'optional')
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')
  return `${parameterPart} · ${pluralise(summary.placements.total, 'placement')}`
}

export type NotebookTemplateNeedsFilter =
  'all' | 'none' | 'optional-only' | 'has-required'

export function matchesNotebookTemplateNeeds(
  summary: Pick<
    NotebookTemplateRequirementSummary,
    'parameterCount' | 'requiredCount'
  >,
  filter: NotebookTemplateNeedsFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'none') return summary.parameterCount === 0
  if (filter === 'optional-only')
    return summary.parameterCount > 0 && summary.requiredCount === 0
  return summary.requiredCount > 0
}
// ---------------------------------------------------------------------------
// Sheet definition requirement previews — parameters, bindings, rowIdentity
// ---------------------------------------------------------------------------

export interface SheetDefinitionRequirementSummary {
  parameterCount: number
  requiredCount: number
  bindingCount: number
  rowIdentityKind: string
  columnCount: number
  joinCount: number
  writeBackRuleCount: number
}

/**
 * Summarise what reusing a sheet definition version involves, from the
 * same configuration the extraction preview (`previewSheetDefinitionExtraction`)
 * and consumer upgrade preview surface: parameters to resolve, dataset
 * bindings to supply, and the row-identity strategy the instance inherits.
 */
export function summarizeSheetDefinitionRequirements(
  configuration: SheetDefinitionConfiguration,
): SheetDefinitionRequirementSummary {
  return {
    parameterCount: configuration.parameters.length,
    requiredCount: configuration.parameters.filter(
      (parameter) => parameter.required,
    ).length,
    bindingCount: configuration.bindings.length,
    rowIdentityKind: configuration.rowIdentity.kind,
    columnCount: configuration.columns.length,
    joinCount: configuration.joins.length,
    writeBackRuleCount: configuration.writeBackRules.length,
  }
}

/** One-line catalogue preview, e.g. "1 required · 2 bindings · identity: source". */
export function sheetDefinitionNeedsLine(
  summary: SheetDefinitionRequirementSummary,
): string {
  const parameterPart =
    summary.parameterCount === 0
      ? 'No parameters'
      : summary.requiredCount > 0
        ? pluralise(summary.requiredCount, 'required', 'required')
        : pluralise(summary.parameterCount, 'optional parameter')
  return `${parameterPart} · ${pluralise(summary.bindingCount, 'binding')} · identity: ${summary.rowIdentityKind}`
}
// ---------------------------------------------------------------------------
// Protocol template requirement previews — blocks + usage + readiness
// ---------------------------------------------------------------------------

/**
 * Catalogue-card preview for protocol templates: block/usage counts plus
 * what instantiation needs (a title and a target project — the inputs the
 * inspector's use-template form collects) and whether the template is
 * currently instantiable.
 */
export function protocolTemplateNeedsLine(options: {
  blockCount: number | undefined
  usageCount: number
  instantiable: boolean
  archived: boolean
}): string {
  const blocks =
    options.blockCount === undefined
      ? 'Blocks unknown'
      : pluralise(options.blockCount, 'block')
  const uses = pluralise(options.usageCount, 'use')
  const readiness = options.archived
    ? 'Archived — cannot be used'
    : options.instantiable
      ? 'Ready — needs a title and target project'
      : 'Not ready — requires active status'
  return `${blocks} · ${uses} · ${readiness}`
}
