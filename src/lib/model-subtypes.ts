import type { DataClient } from '#/lib/data-client'
import {
  builtInModel,
  fetchAddedFieldValues,
  saveAddedFieldValues,
} from '#/lib/built-in-models'
import type { BuiltInModel, BuiltInModelHost } from '#/lib/built-in-models'
import { fetchModelFields } from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import { objectPath, recordDestination } from '#/lib/navigation'

/**
 * Subtypes. Any model can have subtypes, to any depth: a subtype is a
 * workspace record type whose `parent_key` names the model it extends (a
 * built-in model or another record type). Objects of a subtype stay objects
 * of the model at the top of the chain (a Cell culture experiment is listed,
 * reviewed and signed as an experiment) and pin the subtype's published
 * version through `model_version_id`. They carry every field of every model
 * above them plus their own, and use the subtype's own ID prefix.
 */
export interface ModelType {
  id: string
  key: string
  name: string
  prefix: string
  parentKey: string | null
  lifecycle: string
  /** The newest published version, which new objects of the type pin. */
  publishedVersionId: string | null
  /** Every version id, so a pin can be traced back to its type. */
  versionIds: string[]
}

interface ModelRow {
  id: string
  key: string
  name: string
  identifier_prefix: string
  parent_key: string | null
  lifecycle: string
}

interface VersionRow {
  id: string
  model_id: string
  version: number
  lifecycle: string
}

/** Every workspace record type with its parent and published version. */
export async function fetchModelTypes(
  client: DataClient,
): Promise<ModelType[]> {
  const [models, versions] = await Promise.all([
    client.list<ModelRow>(
      'record_models',
      '?select=id,key,name,identifier_prefix,parent_key,lifecycle&order=name.asc',
    ),
    client.list<VersionRow>(
      'record_model_versions',
      '?select=id,model_id,version,lifecycle&order=version.desc',
    ),
  ])
  return models.map((model) => {
    const own = versions.filter((version) => version.model_id === model.id)
    return {
      id: model.id,
      key: model.key,
      name: model.name,
      prefix: model.identifier_prefix,
      parentKey: model.parent_key,
      lifecycle: model.lifecycle,
      publishedVersionId:
        own.find((version) => version.lifecycle === 'published')?.id ?? null,
      versionIds: own.map((version) => version.id),
    }
  })
}

/** The types above `key`, nearest first (a built-in model is not a type). */
export function typeAncestors(
  types: readonly ModelType[],
  key: string,
): ModelType[] {
  const byKey = new Map(types.map((type) => [type.key, type]))
  const chain: ModelType[] = []
  const seen = new Set<string>([key])
  let parent = byKey.get(key)?.parentKey ?? null
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const type = byKey.get(parent)
    if (!type) break
    chain.push(type)
    parent = type.parentKey
  }
  return chain
}

/** The model at the top of `key`'s chain: a built-in key or a root type key. */
export function typeRoot(types: readonly ModelType[], key: string): string {
  const byKey = new Map(types.map((type) => [type.key, type]))
  let current = key
  const seen = new Set<string>()
  for (;;) {
    const type = byKey.get(current)
    if (!type?.parentKey || seen.has(current)) return current
    seen.add(current)
    current = type.parentKey
  }
}

export interface TypeOption {
  type: ModelType
  /** 1 for a direct subtype, 2 for its subtype, and so on. */
  depth: number
}

/** Every type below `key`, depth-first in name order. */
export function typeDescendants(
  types: readonly ModelType[],
  key: string,
): TypeOption[] {
  const out: TypeOption[] = []
  const walk = (parent: string, depth: number) => {
    if (depth > 64) return
    for (const type of types.filter((t) => t.parentKey === parent)) {
      out.push({ type, depth })
      walk(type.key, depth + 1)
    }
  }
  walk(key, 1)
  return out
}

/** Types an object of `rootKey` can take: published ones only. */
export function pickableTypes(
  types: readonly ModelType[],
  rootKey: string,
): TypeOption[] {
  return typeDescendants(types, rootKey).filter(
    (option) => option.type.publishedVersionId !== null,
  )
}

/** The type an object is pinned to, from its `model_version_id`. */
export function typeForVersion(
  types: readonly ModelType[],
  versionId: string | null | undefined,
): ModelType | null {
  if (!versionId) return null
  return types.find((type) => type.versionIds.includes(versionId)) ?? null
}

/** Where objects of a type live, from the model at the top of its chain. */
export function typeHost(
  types: readonly ModelType[],
  key: string,
): { root: string; builtIn: BuiltInModel | null; host: BuiltInModelHost } {
  const root = typeRoot(types, key)
  const builtIn = builtInModel(root) ?? null
  return { root, builtIn, host: builtIn?.host ?? 'record' }
}

export interface FieldGroup {
  /** The model the fields come from. */
  modelKey: string
  modelName: string
  fields: ModelFieldDefinition[]
}

/**
 * Every field an object of `typeKey` carries, from the top of the chain down:
 * a built-in model's added fields, then each type's published fields. The
 * object's own type reads `pinnedVersionId` when given (an older pin keeps its
 * fields); ancestors read their newest published version, as the database
 * does. A null `typeKey` is the root model alone.
 */
export async function fetchTypeFields(
  client: DataClient,
  types: readonly ModelType[],
  rootKey: string,
  typeKey: string | null,
  pinnedVersionId?: string | null,
): Promise<FieldGroup[]> {
  const root = builtInModel(rootKey)
  const byKey = new Map(types.map((type) => [type.key, type]))
  const chain: ModelType[] = []
  if (typeKey && typeKey !== rootKey) {
    const own = byKey.get(typeKey)
    if (own) chain.push(...typeAncestors(types, typeKey).reverse(), own)
  } else if (!root) {
    const own = byKey.get(rootKey)
    if (own) chain.push(own)
  }
  const groups = await Promise.all([
    root
      ? fetchModelFields(client, root.key).then((fields): FieldGroup => ({
          modelKey: root.key,
          modelName: root.name,
          fields,
        }))
      : null,
    ...chain.map(async (type, index): Promise<FieldGroup | null> => {
      const versionId =
        index === chain.length - 1 && pinnedVersionId
          ? pinnedVersionId
          : type.publishedVersionId
      if (!versionId) return null
      const fields = await fetchModelFields(client, type.key, false, versionId)
      return { modelKey: type.key, modelName: type.name, fields }
    }),
  ])
  return groups.filter((group): group is FieldGroup => group !== null)
}

export type TypeHostTable = 'records' | 'project' | 'instrument'

export function hostTable(host: BuiltInModelHost): TypeHostTable {
  return host === 'record' ? 'records' : host
}

/**
 * Change an object's type (until it is signed). `values` replaces its added
 * field values, so the caller passes what the new type keeps. A null
 * `typeKey` returns it to the model at the top of the chain. The object gets
 * the new type's own ID.
 */
export async function setModelType(
  client: DataClient,
  host: BuiltInModelHost,
  objectId: string,
  typeKey: string | null,
  values: Record<string, unknown>,
): Promise<{ identifier: string | null }> {
  const row = await client.rpc<Record<string, unknown>>('set_model_type', {
    p_host: hostTable(host),
    p_id: objectId,
    p_model_key: typeKey,
    p_custom_fields: values,
  })
  const identifier = row.identifier ?? row.display_id
  return { identifier: typeof identifier === 'string' ? identifier : null }
}

/** Keys of every field in the groups, for working out what a change drops. */
export function fieldKeys(groups: readonly FieldGroup[]): Set<string> {
  return new Set(
    groups.flatMap((group) => group.fields.map((field) => field.fieldName)),
  )
}

/** Values a type change keeps, and the labels of those it drops. */
export function valuesForType(
  current: Record<string, unknown>,
  from: readonly FieldGroup[],
  to: readonly FieldGroup[],
): { kept: Record<string, unknown>; dropped: string[] } {
  const keep = fieldKeys(to)
  const labels = new Map(
    from.flatMap((group) =>
      group.fields.map((field) => [field.fieldName, field.label] as const),
    ),
  )
  const kept: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(current)) {
    if (keep.has(key)) kept[key] = value
    else if (value !== null && value !== undefined && value !== '')
      dropped.push(labels.get(key) ?? key)
  }
  return { kept, dropped }
}

/**
 * Save a create form's added fields onto the object it just made. With a
 * subtype picked, the object takes that type (and its ID) and every value at
 * once; otherwise the values are written as usual. Returns the object's ID
 * when the type change gave it a new one.
 */
export async function saveNewObjectFields(
  client: DataClient,
  model: BuiltInModel,
  objectId: string,
  typeKey: string | null,
  values: Record<string, unknown>,
): Promise<{ identifier: string | null }> {
  if (!typeKey) {
    await saveAddedFieldValues(client, model, objectId, values)
    return { identifier: null }
  }
  const { customFields } = await fetchAddedFieldValues(client, model, objectId)
  return setModelType(client, model.host, objectId, typeKey, {
    ...customFields,
    ...values,
  })
}

export interface TypedObject {
  id: string
  identifier: string
  name: string
  /** The page that owns the object. */
  href: string
  customFields: Record<string, unknown>
}

/**
 * The objects of one type (not its subtypes), wherever they live: records of
 * the model at the top of its chain, projects or instruments.
 */
export async function fetchTypedObjects(
  client: DataClient,
  types: readonly ModelType[],
  type: ModelType,
): Promise<TypedObject[]> {
  if (!type.versionIds.length) return []
  const { root, builtIn, host } = typeHost(types, type.key)
  const pins = `model_version_id=in.(${type.versionIds.join(',')})`
  if (host === 'project') {
    const rows = await client.list<{
      id: string
      display_id: string | null
      title: string
      custom_fields: Record<string, unknown> | null
    }>('projects', `?${pins}&select=id,display_id,title,custom_fields`)
    return rows.map((row) => ({
      id: row.id,
      identifier: row.display_id ?? '',
      name: row.title,
      href: objectPath('project', row.id) ?? '',
      customFields: row.custom_fields ?? {},
    }))
  }
  if (host === 'instrument') {
    const rows = await client.list<{
      id: string
      display_id: string | null
      name: string
      custom_fields: Record<string, unknown> | null
    }>('instruments', `?${pins}&select=id,display_id,name,custom_fields`)
    return rows.map((row) => ({
      id: row.id,
      identifier: row.display_id ?? '',
      name: row.name,
      href: objectPath('instrument', row.id) ?? '',
      customFields: row.custom_fields ?? {},
    }))
  }
  const rows = await client.list<{
    id: string
    identifier: string
    title: string
    kind: string
    custom_fields: Record<string, unknown> | null
  }>(
    'records',
    `?${pins}&deleted_at=is.null&order=updated_at.desc&select=id,identifier,title,kind,custom_fields`,
  )
  return rows.map((row) => ({
    id: row.id,
    identifier: row.identifier,
    name: row.title,
    href: builtIn
      ? recordDestination(row.kind, row.id)
      : `/models/${encodeURIComponent(root)}/records/${encodeURIComponent(row.id)}`,
    customFields: row.custom_fields ?? {},
  }))
}
