import type {
  NotebookTemplateConfiguration,
  NotebookTemplatePlacement,
} from './notebook-template'
import type { Parameter } from './parameter'

/**
 * R5-CONFIG-04: the change set of one Notebook Template Version against the
 * version before it, read from the stored definitions.
 *
 * The comparison is deliberately the one `api.preview_notebook_template_upgrade`
 * already performs per record: placements are identified by their `id`, and a
 * sheet placement's pin is its `definitionVersionId`. This screen diffs the two
 * published definitions directly (the upgrade path needs a record to preview),
 * so the change set the reader sees and the update preview agree on what
 * "added", "changed" and "removed" mean.
 */

export type TemplateChangeTag = 'added' | 'removed' | 'changed'
export type TemplateChangeKind = 'placement' | 'parameter'

export interface TemplateChangeSetEntry {
  /** The placement id or parameter id the change is keyed on. */
  id: string
  kind: TemplateChangeKind
  tag: TemplateChangeTag
  label: string
  /** The field that changed; absent for added and removed entries. */
  field?: string
  before?: string
  after?: string
}

function placementLabel(placement: NotebookTemplatePlacement): string {
  switch (placement.kind) {
    case 'sheet':
      return `Sheet · ${placement.title ?? placement.id.slice(0, 8)}`
    case 'section_placeholder':
      return `Section · ${placement.label}`
    default:
      return `Block · ${placement.blockType}`
  }
}

function placementFieldLabel(field: string): string {
  switch (field) {
    case 'order':
      return 'Order'
    case 'blockType':
      return 'Block type'
    case 'payload':
      return 'Content'
    case 'definitionVersionId':
      return 'Sheet definition version'
    case 'title':
      return 'Title'
    case 'parameterMappings':
      return 'Parameter mappings'
    case 'key':
      return 'Key'
    case 'label':
      return 'Label'
    default:
      return field
  }
}

function placementFields(
  placement: NotebookTemplatePlacement,
): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['order', String(placement.order)],
    ['kind', placement.kind],
  ]
  if (placement.kind === 'narrative') {
    fields.push(['blockType', placement.blockType])
    fields.push(['payload', JSON.stringify(placement.payload)])
  } else if (placement.kind === 'sheet') {
    fields.push(['definitionVersionId', placement.definitionVersionId])
    if (placement.title) fields.push(['title', placement.title])
    fields.push([
      'parameterMappings',
      JSON.stringify(
        [...placement.parameterMappings].sort((a, b) =>
          a.templateParameterId.localeCompare(b.templateParameterId),
        ),
      ),
    ])
  } else {
    fields.push(['key', placement.key])
    fields.push(['label', placement.label])
  }
  return fields
}

function parameterTypeLabel(type: Parameter['type']): string {
  switch (type.kind) {
    case 'scalar':
      return `scalar · ${type.valueType}`
    case 'record':
      return `record · ${type.modelKey}`
    case 'dataset':
      return `dataset · ${type.contract.mode}`
    case 'dataset-version':
      return `dataset version · ${type.contract.mode}`
  }
}

function parameterLabel(parameter: Parameter): string {
  return `Parameter · ${parameter.label}`
}

function parameterFields(parameter: Parameter): Array<[string, string]> {
  return [
    ['key', parameter.key],
    ['label', parameter.label],
    ['required', parameter.required ? 'Required' : 'Optional'],
    ['type', parameterTypeLabel(parameter.type)],
  ]
}

function changedFields(
  kind: TemplateChangeKind,
  id: string,
  baseLabel: string,
  before: Array<[string, string]>,
  after: Array<[string, string]>,
): TemplateChangeSetEntry[] {
  const beforeByField = new Map(before)
  const entries: TemplateChangeSetEntry[] = []
  for (const [field, afterValue] of after) {
    const beforeValue = beforeByField.get(field)
    if (beforeValue === undefined || beforeValue === afterValue) continue
    entries.push({
      id,
      kind,
      tag: 'changed',
      label: baseLabel,
      field: kind === 'placement' ? placementFieldLabel(field) : field,
      before: beforeValue,
      after: afterValue,
    })
  }
  return entries
}

/**
 * Every added, removed and changed placement and parameter between two stored
 * definitions. An undefined `previous` is the first version, so everything in
 * `next` is added.
 */
export function changeSetFromVersions(
  previous: NotebookTemplateConfiguration | undefined,
  next: NotebookTemplateConfiguration,
): TemplateChangeSetEntry[] {
  const entries: TemplateChangeSetEntry[] = []

  const previousPlacements = new Map(
    (previous?.placements ?? []).map((place) => [place.id, place]),
  )
  const nextPlacementIds = new Set(next.placements.map((place) => place.id))
  for (const placement of [...next.placements].sort(
    (a, b) => a.order - b.order,
  )) {
    const before = previousPlacements.get(placement.id)
    if (!before) {
      entries.push({
        id: placement.id,
        kind: 'placement',
        tag: 'added',
        label: placementLabel(placement),
        after: placementFields(placement)
          .map(([field, value]) => `${placementFieldLabel(field)}: ${value}`)
          .join(' · '),
      })
      continue
    }
    entries.push(
      ...changedFields(
        'placement',
        placement.id,
        placementLabel(placement),
        placementFields(before),
        placementFields(placement),
      ),
    )
  }
  for (const placement of previous?.placements ?? []) {
    if (nextPlacementIds.has(placement.id)) continue
    entries.push({
      id: placement.id,
      kind: 'placement',
      tag: 'removed',
      label: placementLabel(placement),
      before: placementFields(placement)
        .map(([field, value]) => `${placementFieldLabel(field)}: ${value}`)
        .join(' · '),
    })
  }

  const previousParameters = new Map(
    (previous?.parameters ?? []).map((parameter) => [parameter.id, parameter]),
  )
  const nextParameterIds = new Set(next.parameters.map((item) => item.id))
  for (const parameter of next.parameters) {
    const before = previousParameters.get(parameter.id)
    if (!before) {
      entries.push({
        id: parameter.id,
        kind: 'parameter',
        tag: 'added',
        label: parameterLabel(parameter),
        after: `${parameterTypeLabel(parameter.type)}${
          parameter.required ? ' · required' : ''
        }`,
      })
      continue
    }
    entries.push(
      ...changedFields(
        'parameter',
        parameter.id,
        parameterLabel(parameter),
        parameterFields(before),
        parameterFields(parameter),
      ),
    )
  }
  for (const parameter of previous?.parameters ?? []) {
    if (nextParameterIds.has(parameter.id)) continue
    entries.push({
      id: parameter.id,
      kind: 'parameter',
      tag: 'removed',
      label: parameterLabel(parameter),
      before: parameterTypeLabel(parameter.type),
    })
  }

  return entries
}
