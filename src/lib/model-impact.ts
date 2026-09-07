import type { DataClient } from '#/lib/data-client'
import type {
  DependencyDiscovery,
  ObjectDependency,
} from '#/lib/object-dependencies'

/**
 * MODEL-04 — per-model impact report. Server authority is
 * `api.discover_model_dependencies`: field definitions, host rows carrying
 * custom values, MODEL-03 rules referencing the model, Sheet Definition
 * Versions whose record parameters name the model, Sheet Instances binding
 * a record of the model, and Notebook Template Versions with a record
 * parameter (or a placement pinning a dependent Sheet version).
 */
export interface ModelImpactReport extends DependencyDiscovery {
  truncated?: boolean
}

export async function discoverModelImpact(
  client: DataClient,
  modelKey: string,
): Promise<ModelImpactReport> {
  return client.rpc('discover_model_dependencies', {
    p_model_key: modelKey,
  })
}

export type ModelImpactGroup =
  'fields' | 'records' | 'rules' | 'sheets' | 'templates' | 'other'

export const MODEL_IMPACT_GROUP_TITLES: Record<ModelImpactGroup, string> = {
  fields: 'Fields',
  records: 'Records & host rows',
  rules: 'Relationship rules',
  sheets: 'Sheets',
  templates: 'Templates',
  other: 'Other',
}

const GROUP_ORDER: ModelImpactGroup[] = [
  'fields',
  'records',
  'rules',
  'sheets',
  'templates',
  'other',
]

/** Classify a dependency kind into its impact-panel group. */
export function classifyModelImpactKind(kind: string): ModelImpactGroup {
  if (kind === 'model_field') return 'fields'
  if (
    kind === 'record' ||
    kind === 'project' ||
    kind === 'plate_design' ||
    kind === 'instrument' ||
    kind === 'instrument_run' ||
    kind === 'dataset_schema' ||
    kind === 'scientific_table'
  )
    return 'records'
  if (kind === 'model_relationship_rule') return 'rules'
  if (kind === 'sheet_definition_version' || kind === 'sheet_instance')
    return 'sheets'
  if (kind === 'notebook_template_version') return 'templates'
  return 'other'
}

export interface ModelImpactGroupView {
  group: ModelImpactGroup
  title: string
  items: ObjectDependency[]
}

/** Order dependencies into their panel groups, dropping empty groups. */
export function groupModelImpact(
  dependencies: ObjectDependency[],
): ModelImpactGroupView[] {
  const buckets = new Map<ModelImpactGroup, ObjectDependency[]>()
  for (const item of dependencies) {
    const group = classifyModelImpactKind(item.kind)
    const bucket = buckets.get(group)
    if (bucket) bucket.push(item)
    else buckets.set(group, [item])
  }
  return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    title: MODEL_IMPACT_GROUP_TITLES[group],
    items: buckets.get(group) ?? [],
  }))
}

/** Count of dependents that require steward handling (non-informational). */
export function countActionableModelImpact(
  dependencies: ObjectDependency[],
): number {
  return dependencies.filter((item) => item.effect !== 'informational').length
}
