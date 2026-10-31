import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import type { DataClient } from '#/lib/data-client'
import type { FieldLogicalType } from '#/lib/field-definition'
import { BUILT_IN_MODELS } from '#/lib/built-in-models'
import { listByIds } from '#/lib/chunk-ids'
import { matchOptions } from '#/lib/search-fields'

/**
 * Model fields in the search builder. Every field a workspace adds to a model
 * (Sample, Experiment, a Cell culture subtype, Project, Instrument…) is offered
 * as "Sample · Concentration (mg/mL)". The id names the kind of thing the index
 * holds and the field key, `model:<kind>:<key>`, and `filterToRpc` sends it as
 * that kind AND `fields.<key>`, so two models with a field of the same name
 * stay apart.
 */

export const MODEL_FIELD_PREFIX = 'model:'

/** Kinds of things the search index holds that carry model fields. */
const INDEXED_KINDS = new Set([
  'experiment',
  'sample',
  'material',
  'protocol_template',
  'study',
  'project',
  'instrument',
  'instrument_run',
])

export interface ModelFieldWire {
  id: string
  kind: string
  field_name: string
  label: string
  logical_type: FieldLogicalType
  cardinality?: 'one' | 'many' | null
  quantity?: { storageUnit?: string } | null
  unit?: { symbol?: string } | null
}

export interface ModelOptionWire {
  definition_id: string
  key: string
  label: string
}

export interface RecordModelWire {
  key: string
  name: string
  parent_key: string | null
}

export function modelFieldId(kind: string, fieldName: string): string {
  return `${MODEL_FIELD_PREFIX}${kind}:${fieldName}`
}

/** `{ kind, key }` for a model field id, or undefined for any other field. */
export function parseModelFieldId(
  id: string,
): { kind: string; key: string } | undefined {
  if (!id.startsWith(MODEL_FIELD_PREFIX)) return undefined
  const rest = id.slice(MODEL_FIELD_PREFIX.length)
  const at = rest.indexOf(':')
  if (at <= 0 || at === rest.length - 1) return undefined
  return { kind: rest.slice(0, at), key: rest.slice(at + 1) }
}

function dataTypeOf(type: FieldLogicalType): SheetbaseField['dataType'] {
  switch (type) {
    case 'integer':
    case 'decimal':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'date':
    case 'timestamp':
      return 'date'
    default:
      return 'text'
  }
}

/**
 * The kind the index files a model's objects under: a subtype's top model. A
 * workspace's own top-level model (Cell bank) is indexed under its own key.
 */
function indexedKind(
  key: string,
  models: ReadonlyMap<string, RecordModelWire>,
): string | undefined {
  const seen = new Set<string>()
  let current: string | null | undefined = key
  while (current && !seen.has(current)) {
    if (INDEXED_KINDS.has(current)) return current
    seen.add(current)
    const model = models.get(current)
    if (model && !model.parent_key) return current
    current = model?.parent_key
  }
  return undefined
}

/**
 * The builder fields for the workspace's model fields. Multi-value fields and
 * references are left out: the index keeps single values only, so they could
 * never match.
 */
export function modelSearchFields(
  definitions: readonly ModelFieldWire[],
  options: readonly ModelOptionWire[],
  recordModels: readonly RecordModelWire[],
): SheetbaseField[] {
  const models = new Map(recordModels.map((m) => [m.key, m]))
  const builtIn = new Map(BUILT_IN_MODELS.map((m) => [m.key, m.name]))
  const optionsBy = new Map<string, { value: string; label: string }[]>()
  for (const option of options) {
    const list = optionsBy.get(option.definition_id) ?? []
    list.push({ value: option.key, label: option.label })
    optionsBy.set(option.definition_id, list)
  }
  const out = new Map<string, SheetbaseField>()
  for (const field of definitions) {
    if (field.cardinality === 'many' || field.logical_type === 'reference')
      continue
    const kind = indexedKind(field.kind, models)
    if (!kind) continue
    const id = modelFieldId(kind, field.field_name)
    if (out.has(id)) continue
    const model =
      models.get(field.kind)?.name ?? builtIn.get(field.kind) ?? field.kind
    const unit = field.quantity?.storageUnit ?? field.unit?.symbol
    const choices = optionsBy.get(field.id)
    out.set(id, {
      id,
      label: `${model} · ${field.label}${unit ? ` (${unit})` : ''}`,
      dataType: dataTypeOf(field.logical_type),
      ...(choices?.length
        ? { loadOptions: async (query: string) => matchOptions(choices, query) }
        : {}),
    })
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** Every active model field the person can see, as builder fields. */
export async function fetchModelSearchFields(
  client: DataClient,
): Promise<SheetbaseField[]> {
  const [builtInFields, recordModels, versions] = await Promise.all([
    client.list<ModelFieldWire>(
      'record_field_definitions',
      '?lifecycle=eq.active&select=id,kind,field_name,label,logical_type,cardinality,quantity,unit',
    ),
    client.list<RecordModelWire & { id: string }>(
      'record_models',
      '?select=id,key,name,parent_key',
    ),
    client.list<{
      model_id: string
      version: number
      definition: {
        fields?: (Omit<ModelFieldWire, 'kind'> & {
          lifecycle?: string
          options?: { key: string; label: string; lifecycle?: string }[]
        })[]
      }
    }>(
      'record_model_versions',
      '?lifecycle=eq.published&order=version.desc&select=model_id,version,definition',
    ),
  ])
  // Read in groups: the proxy refuses an `in.(…)` list of many ids.
  const options = await listByIds(
    builtInFields.map((f) => f.id),
    (ids) =>
      client.list<ModelOptionWire>(
        'model_field_options',
        `?definition_id=in.(${ids})&lifecycle=eq.active&select=definition_id,key,label&order=display_order.asc`,
      ),
  )
  // A record type's fields live on its newest published version.
  const keyOf = new Map(recordModels.map((m) => [m.id, m.key]))
  const latest = new Set<string>()
  const typeFields: ModelFieldWire[] = []
  const typeOptions: ModelOptionWire[] = []
  for (const version of versions) {
    const key = keyOf.get(version.model_id)
    if (!key || latest.has(key)) continue
    latest.add(key)
    for (const field of version.definition.fields ?? []) {
      if (field.lifecycle && field.lifecycle !== 'active') continue
      typeFields.push({ ...field, kind: key })
      for (const option of field.options ?? [])
        if (!option.lifecycle || option.lifecycle === 'active')
          typeOptions.push({
            definition_id: field.id,
            key: option.key,
            label: option.label,
          })
    }
  }
  return modelSearchFields(
    [...builtInFields, ...typeFields],
    [...options, ...typeOptions],
    recordModels,
  )
}
