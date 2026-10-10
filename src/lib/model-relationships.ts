import { useQuery } from '@tanstack/react-query'

/**
 * MODEL-03 — Model relationship rules: typed links a Model's records accept.
 *
 * Rules live in `api.model_relationship_rules` (workspace-scoped; the source
 * is a built-in `model_kinds` key or a same-workspace `record_models` key, the
 * target a built-in `model_kinds` key; the links stay authoritative in
 * `record_links`). Enforcement is server-side in
 * `internal.assert_model_relationship_rule`, which fails closed with
 * SB080 (undeclared type/target pair) and SB081 (maximum exceeded)
 * wherever a link is created. This module is the client mirror: fetching,
 * stewardship RPCs, the same allowability policy as pure functions, and
 * the KNOW label feed (rule-declared display names preferred over the
 * canonical `relationshipLabel` vocabulary).
 *
 * Policy grain (mirrors the trigger): the world closes per source Model.
 * A source Model with no declared rules is unrestricted; a Model with any
 * rule allows only its declared (link type, target model) pairs.
 * Reference-field selection is type-agnostic, so `isReferenceTargetAllowed`
 * aggregates across all of the source model's declared link types: a
 * target absent from every declared relationship is not offered.
 */
import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'
import { relationshipLabel } from '#/lib/lineage-data'

/** Shared client for the rules hooks (same shape as the lineage client). */
export const modelRelationshipsDataClient = createDataClient()

/**
 * Reactive rules for one source Model. Silent while model-less; failures
 * resolve to no rules so panels fall back to the canonical vocabulary
 * instead of hiding relationships.
 */
export function useModelRelationshipRules(
  sourceModelKey: string | null | undefined,
  options: { client?: DataClient; enabled?: boolean } = {},
): { rules: ModelRelationshipRule[]; isLoading: boolean } {
  const { client = modelRelationshipsDataClient, enabled = true } = options
  const rulesQuery = useQuery({
    queryKey:
      sourceModelKey != null
        ? modelRelationshipQueryKeys.rulesFor(sourceModelKey)
        : modelRelationshipQueryKeys.rules,
    queryFn: () => fetchModelRelationshipRules(client, sourceModelKey ?? ''),
    enabled: enabled && sourceModelKey != null && sourceModelKey !== '',
    staleTime: 60_000,
  })
  return { rules: rulesQuery.data ?? [], isLoading: rulesQuery.isLoading }
}

/**
 * KNOW label feed for one source Model: declared display names keyed by
 * link type, for `useRelationships` / `buildRelationshipRows`.
 */
export function useRelationshipTypeLabels(
  sourceModelKey: string | null | undefined,
  options: { client?: DataClient; enabled?: boolean } = {},
): Record<string, string> | undefined {
  const { rules } = useModelRelationshipRules(sourceModelKey, options)
  if (sourceModelKey == null || sourceModelKey === '') return undefined
  const labels = relationshipTypeLabels(rules)
  return Object.keys(labels).length > 0 ? labels : undefined
}

/** The `record_links.link_type` vocabulary rules may declare. */
export const MODEL_LINK_TYPES = [
  'sample',
  'protocol',
  'dataset',
  'material',
  'analysis',
  'file',
  'general',
  'template',
] as const

export type ModelLinkType = (typeof MODEL_LINK_TYPES)[number]

export function isModelLinkType(value: string): value is ModelLinkType {
  return (MODEL_LINK_TYPES as readonly string[]).includes(value)
}

/** One declared typed relationship between two canonical Models. */
export interface ModelRelationshipRule {
  id: string
  sourceModelKey: string
  linkType: string
  targetModelKey: string
  minLinks: number
  /** NULL means unbounded. */
  maxLinks: number | null
  /** Optional display name surfaced in panels and pickers. */
  label: string | null
}

interface ModelRelationshipRuleWire {
  id: string
  workspace_id?: string
  source_model_key: string
  link_type: string
  target_model_key: string
  min_links: number
  max_links: number | null
  label: string | null
}

export function toModelRelationshipRule(
  row: ModelRelationshipRuleWire,
): ModelRelationshipRule {
  return {
    id: row.id,
    sourceModelKey: row.source_model_key,
    linkType: row.link_type,
    targetModelKey: row.target_model_key,
    minLinks: row.min_links,
    maxLinks: row.max_links,
    label: row.label,
  }
}

export const modelRelationshipQueryKeys = {
  rules: ['model-relationship-rules'] as const,
  rulesFor: (sourceModelKey: string) =>
    ['model-relationship-rules', sourceModelKey] as const,
}

/**
 * Fetch the declared rules, optionally scoped to one source Model. Plain
 * PostgREST read under workspace RLS — members can read their workspace's
 * rules; other workspaces stay invisible.
 */
export async function fetchModelRelationshipRules(
  client: DataClient,
  sourceModelKey?: string,
): Promise<ModelRelationshipRule[]> {
  const filter = sourceModelKey
    ? `?source_model_key=eq.${encodeURIComponent(sourceModelKey)}&order=link_type.asc,target_model_key.asc`
    : '?order=source_model_key.asc,link_type.asc,target_model_key.asc'
  const rows = await client.list<ModelRelationshipRuleWire>(
    'model_relationship_rules',
    filter,
  )
  return rows.map(toModelRelationshipRule)
}

export interface ConfigureModelRelationshipRuleInput {
  workspaceId: string
  sourceModelKey: string
  linkType: string
  targetModelKey: string
  minLinks?: number
  maxLinks?: number | null
  label?: string | null
}

/**
 * Declare (upsert) one rule. Owner/admin only on the server
 * (`api.is_model_field_admin`); malformed declarations fail as SB071.
 */
export function configureModelRelationshipRule(
  client: DataClient,
  input: ConfigureModelRelationshipRuleInput,
): Promise<unknown> {
  return client.rpc('configure_model_relationship_rule', {
    p_workspace_id: input.workspaceId,
    p_source_model_key: input.sourceModelKey,
    p_link_type: input.linkType,
    p_target_model_key: input.targetModelKey,
    p_min_links: input.minLinks ?? 0,
    p_max_links: input.maxLinks ?? null,
    p_label: input.label ?? null,
  })
}

/** Remove one rule by id. Owner/admin only on the server. */
export function removeModelRelationshipRule(
  client: DataClient,
  ruleId: string,
): Promise<unknown> {
  return client.rpc('remove_model_relationship_rule', { p_rule_id: ruleId })
}

// ---------------------------------------------------------------------------
// Policy — pure mirrors of the server trigger grain.
// ---------------------------------------------------------------------------

/** Rules declared for one (source model, link type) pair. */
export function rulesForLinkType(
  rules: readonly ModelRelationshipRule[],
  sourceModelKey: string,
  linkType: string,
): ModelRelationshipRule[] {
  return rules.filter(
    (rule) =>
      rule.sourceModelKey === sourceModelKey && rule.linkType === linkType,
  )
}

/** All rules declared for one source Model. */
export function rulesForSourceModel(
  rules: readonly ModelRelationshipRule[],
  sourceModelKey: string,
): ModelRelationshipRule[] {
  return rules.filter((rule) => rule.sourceModelKey === sourceModelKey)
}

/**
 * Whether a typed edge to a target Model is allowed. True when the source
 * model declares no rules at all (unrestricted — current behaviour);
 * otherwise the (link type, target model) pair must be declared.
 */
export function isLinkAllowed(
  rules: readonly ModelRelationshipRule[],
  edge: { sourceModelKey: string; linkType: string; targetModelKey: string },
): boolean {
  const declared = rulesForSourceModel(rules, edge.sourceModelKey)
  if (declared.length === 0) return true
  return declared.some(
    (rule) =>
      rule.linkType === edge.linkType &&
      rule.targetModelKey === edge.targetModelKey,
  )
}

/**
 * Target models offered for one (source model, link type). NULL means the
 * source Model declares nothing (unrestricted — offer every candidate as
 * today); otherwise only the declared targets, possibly none.
 */
export function allowedTargetModels(
  rules: readonly ModelRelationshipRule[],
  sourceModelKey: string,
  linkType: string,
): string[] | null {
  if (rulesForSourceModel(rules, sourceModelKey).length === 0) return null
  return rulesForLinkType(rules, sourceModelKey, linkType).map(
    (rule) => rule.targetModelKey,
  )
}

/**
 * Link types constrained for one source Model. NULL means the model
 * declares nothing — every type keeps current behaviour.
 */
export function allowedLinkTypes(
  rules: readonly ModelRelationshipRule[],
  sourceModelKey: string,
): string[] | null {
  const declared = rulesForSourceModel(rules, sourceModelKey)
  if (declared.length === 0) return null
  return [...new Set(declared.map((rule) => rule.linkType))]
}

/**
 * Whether a reference-field target Model may be offered for a source
 * Model. Reference selection is type-agnostic, so the target must appear
 * under at least one of the source model's declared link types; a source
 * with no rules at all is unrestricted.
 */
export function isReferenceTargetAllowed(
  rules: readonly ModelRelationshipRule[],
  sourceModelKey: string,
  targetModelKey: string,
): boolean {
  const declared = rulesForSourceModel(rules, sourceModelKey)
  if (declared.length === 0) return true
  return declared.some((rule) => rule.targetModelKey === targetModelKey)
}

// ---------------------------------------------------------------------------
// Counts and completeness.
// ---------------------------------------------------------------------------

/** Minimal edge shape needed to count links against a rule. */
export interface CountableLink {
  linkType: string
  /** Declared target kind (record kind for record links). */
  targetKind: string
}

/**
 * Resolve a link's effective target Model from its declared kind. Accepts
 * an optional `recordKind -> model key` map (from `fetchModelKinds`);
 * without it, target kinds address model keys directly, which holds for
 * every record-backed seed (`sample` -> `sample`, …).
 */
export function linkTargetModelKey(
  link: Pick<CountableLink, 'targetKind'>,
  recordKindToModelKey?: Readonly<Record<string, string>>,
): string {
  return recordKindToModelKey?.[link.targetKind] ?? link.targetKind
}

/** Edges of one source record counted against one rule's target Model. */
export function countLinksForRule(
  links: readonly CountableLink[],
  rule: Pick<ModelRelationshipRule, 'linkType' | 'targetModelKey'>,
  recordKindToModelKey?: Readonly<Record<string, string>>,
): number {
  return links.filter(
    (link) =>
      link.linkType === rule.linkType &&
      linkTargetModelKey(link, recordKindToModelKey) === rule.targetModelKey,
  ).length
}

export interface ModelRelationshipStatus {
  count: number
  minSatisfied: boolean
  /** NULL when the rule is unbounded. */
  remaining: number | null
  atMaximum: boolean
}

export function relationshipRuleStatus(
  rule: Pick<ModelRelationshipRule, 'minLinks' | 'maxLinks'>,
  count: number,
): ModelRelationshipStatus {
  return {
    count,
    minSatisfied: count >= rule.minLinks,
    remaining:
      rule.maxLinks === null ? null : Math.max(0, rule.maxLinks - count),
    atMaximum: rule.maxLinks !== null && count >= rule.maxLinks,
  }
}

// ---------------------------------------------------------------------------
// KNOW label feed.
// ---------------------------------------------------------------------------

/**
 * Display names declared by rules, keyed by link type. First declared
 * label wins when several rules share a link type.
 */
export function relationshipTypeLabels(
  rules: readonly Pick<ModelRelationshipRule, 'linkType' | 'label'>[],
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const rule of rules) {
    if (rule.label && !(rule.linkType in labels)) {
      labels[rule.linkType] = rule.label
    }
  }
  return labels
}

/**
 * Label for one link type: the source Model's declared name when it has
 * one, otherwise the canonical `relationshipLabel` vocabulary (which
 * passes unknown types through verbatim so model-declared names always
 * render honestly).
 */
export function resolveRelationshipLabel(
  linkType: string,
  rules?: readonly Pick<ModelRelationshipRule, 'linkType' | 'label'>[],
): string {
  if (rules) {
    const declared = rules.find(
      (rule) => rule.linkType === linkType && rule.label,
    )
    if (declared?.label) return declared.label
  }
  return relationshipLabel(linkType)
}

// ---------------------------------------------------------------------------
// Server rejection matchers.
// ---------------------------------------------------------------------------

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  return 'code' in error && typeof error.code === 'string' ? error.code : null
}

function errorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  return 'message' in error && typeof error.message === 'string'
    ? error.message
    : ''
}

/**
 * Recognise the SB080 fail-closed rejection: the (link type, target
 * model) pair is not declared for the source Model, or the target model
 * is not recognised while rules constrain the type.
 */
export function isRelationshipNotAllowedError(error: unknown): boolean {
  if (errorCode(error) === 'SB080') return true
  return /not allowed for model|target model is not recognised/i.test(
    errorMessage(error),
  )
}

/**
 * Recognise the SB081 fail-closed rejection: the edge would exceed the
 * rule's maximum count for the (source model, link type, target model).
 */
export function isRelationshipCardinalityError(error: unknown): boolean {
  if (errorCode(error) === 'SB081') return true
  return /exceeds the maximum/i.test(errorMessage(error))
}

/** Friendly linker message for an SB080 rejection. */
export const RELATIONSHIP_NOT_ALLOWED_MESSAGE =
  'This Model does not accept that kind of link.'

/** Friendly linker message for an SB081 rejection. */
export const RELATIONSHIP_CARDINALITY_MESSAGE =
  'This record already has the maximum number of links of that kind.'

// ---------------------------------------------------------------------------
// Migration guidance — pure mirrors of the server enforcement grain for the
// steward preview. Rule changes alter link-creation meaning (SB080/SB081);
// local working state is never auto-migrated, so every change names what
// the steward must do downstream instead.
// ---------------------------------------------------------------------------

export interface PendingRelationshipDeclaration {
  sourceModelKey: string
  linkType: string
  targetModelKey: string
  minLinks: number
  maxLinks: number | null
}

/**
 * Steward-facing consequences of declaring (or re-declaring) one rule.
 * Mirrors the trigger grain: the first declaration for a source Model
 * closes the world for that model; maxima fail closed at creation;
 * minima are completeness metadata, never write-time enforcement.
 */
export function ruleDeclarationGuidance(
  pending: PendingRelationshipDeclaration,
  existingSourceRules: number,
): string[] {
  const guidance: string[] = []
  if (existingSourceRules === 0) {
    guidance.push(
      `This first declaration closes the world for model “${pending.sourceModelKey}”: from now on only declared (link type, target model) pairs are accepted at link creation, and anything else is rejected.`,
    )
  }
  if (pending.maxLinks !== null) {
    guidance.push(
      `Links beyond the maximum of ${pending.maxLinks} are rejected when created. Existing over-maximum links stay readable but cannot be recreated once removed — review them before tightening.`,
    )
  }
  if (pending.minLinks > 0) {
    guidance.push(
      `The minimum of ${pending.minLinks} is completeness metadata for readers; it is never enforced when links are created, so under-linked records need a steward pass, not a migration.`,
    )
  }
  guidance.push(
    'Declaring a rule never rewrites existing links or local working state; it only changes which future links are accepted.',
  )
  return guidance
}

/**
 * Steward-facing consequences of removing one rule. Removing the last
 * declaration for a (source model, link type) pair re-opens that pair;
 * removing the last rule of the model restores unrestricted behaviour.
 */
export function ruleRemovalGuidance(
  rule: Pick<
    ModelRelationshipRule,
    'sourceModelKey' | 'linkType' | 'targetModelKey'
  >,
  remainingForLinkType: number,
  remainingForSource: number,
): string[] {
  if (remainingForSource === 0) {
    return [
      `Removing this last declaration restores unrestricted links for model “${rule.sourceModelKey}”: every link type is accepted again. Existing links are unaffected.`,
    ]
  }
  if (remainingForLinkType === 0) {
    return [
      `Removing this declaration re-opens “${rule.linkType}” links for model “${rule.sourceModelKey}”: that type no longer requires a declared target. Existing links are unaffected.`,
    ]
  }
  return [
    `Other declarations still constrain “${rule.linkType}” links for model “${rule.sourceModelKey}”. Existing links are unaffected.`,
  ]
}
