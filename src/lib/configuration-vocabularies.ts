import type { DataClient } from '#/lib/data-client'
import {
  listCanonicalDatasetSchemaDefinitions,
  listCanonicalDatasetSchemaVersionFields,
  listCanonicalDatasetSchemaVersions,
} from '#/lib/dataset-schema-definition-rpc'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'
import type { FieldOption } from '#/lib/field-definition'
import { fetchModelFields, fetchModelKinds } from '#/lib/model-fields'
import { parseSheetDefinitionConfiguration } from '#/lib/sheet-definition'
import type { SheetDefinitionConfiguration } from '#/lib/sheet-definition'
import { fetchSheetDefinitions } from '#/lib/sheet-definition-data'

export type ConfigurationVocabularySourceKind =
  'model' | 'schema' | 'definition'

export interface ConfigurationVocabularyTerm {
  id: string
  key: string
  label: string
  lifecycle: string
}

export interface ConfigurationVocabulary {
  id: string
  label: string
  sourceKind: ConfigurationVocabularySourceKind
  sourceId: string
  sourceLabel: string
  fieldKey: string
  categoryKind: 'embedded' | 'vocabulary'
  vocabularyId: string | null
  terms: ConfigurationVocabularyTerm[]
}

type SchemaCategoryWire =
  | { kind: 'embedded'; options: FieldOption[] }
  | { kind: 'vocabulary'; vocabularyId: string }

interface SheetDefinitionVersionWire {
  id: string
  definition_id: string
  version: number
  configuration: unknown
}

function parseCategory(value: unknown): SchemaCategoryWire | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.kind === 'vocabulary' && typeof record.vocabularyId === 'string') {
    return { kind: 'vocabulary', vocabularyId: record.vocabularyId }
  }
  if (record.kind === 'embedded' && Array.isArray(record.options)) {
    const options = record.options.flatMap((option) => {
      if (!option || typeof option !== 'object') return []
      const item = option as Record<string, unknown>
      if (
        typeof item.id !== 'string' ||
        typeof item.key !== 'string' ||
        typeof item.label !== 'string'
      ) {
        return []
      }
      return [
        {
          id: item.id,
          key: item.key,
          label: item.label,
          displayOrder:
            typeof item.displayOrder === 'number' ? item.displayOrder : 0,
          lifecycle:
            item.lifecycle === 'retired'
              ? ('retired' as const)
              : ('active' as const),
        },
      ]
    })
    return { kind: 'embedded', options }
  }
  return null
}

function termsFromOptions(
  options: FieldOption[],
): ConfigurationVocabularyTerm[] {
  return options.map((option) => ({
    id: option.id,
    key: option.key,
    label: option.label,
    lifecycle: option.lifecycle,
  }))
}

export function collectModelVocabularies(
  modelKey: string,
  modelLabel: string,
  fields: Awaited<ReturnType<typeof fetchModelFields>>,
): ConfigurationVocabulary[] {
  const items: ConfigurationVocabulary[] = []
  for (const field of fields) {
    if (field.logicalType !== 'category') continue
    const categorySource = field.categorySource
    if (categorySource?.kind === 'vocabulary') {
      items.push({
        id: `model:${field.id}`,
        label: field.label,
        sourceKind: 'model',
        sourceId: modelKey,
        sourceLabel: modelLabel,
        fieldKey: field.fieldName,
        categoryKind: 'vocabulary',
        vocabularyId: categorySource.vocabularyId,
        terms: [],
      })
      continue
    }
    if (field.options.length > 0) {
      items.push({
        id: `model:${field.id}`,
        label: field.label,
        sourceKind: 'model',
        sourceId: modelKey,
        sourceLabel: modelLabel,
        fieldKey: field.fieldName,
        categoryKind: 'embedded',
        vocabularyId: null,
        terms: termsFromOptions(field.options),
      })
    }
  }
  return items
}

export function collectSchemaVocabularies(
  schemaId: string,
  schemaLabel: string,
  fields: CanonicalDatasetSchemaField[],
): ConfigurationVocabulary[] {
  const items: ConfigurationVocabulary[] = []
  for (const field of fields) {
    if (field.logical_type !== 'category') continue
    const category = parseCategory(field.category)
    if (category?.kind === 'vocabulary') {
      items.push({
        id: `schema:${field.field_id}`,
        label: field.label,
        sourceKind: 'schema',
        sourceId: schemaId,
        sourceLabel: schemaLabel,
        fieldKey: field.key,
        categoryKind: 'vocabulary',
        vocabularyId: category.vocabularyId,
        terms: [],
      })
      continue
    }
    if (category?.kind === 'embedded' && category.options.length > 0) {
      items.push({
        id: `schema:${field.field_id}`,
        label: field.label,
        sourceKind: 'schema',
        sourceId: schemaId,
        sourceLabel: schemaLabel,
        fieldKey: field.key,
        categoryKind: 'embedded',
        vocabularyId: null,
        terms: termsFromOptions(category.options),
      })
    }
  }
  return items
}

export function collectDefinitionVocabularies(
  definitionId: string,
  definitionLabel: string,
  configuration: SheetDefinitionConfiguration,
): ConfigurationVocabulary[] {
  const items: ConfigurationVocabulary[] = []
  for (const column of configuration.columns) {
    const field = column.field
    if (field.logicalType !== 'category') continue
    const category = field.category
    if (category?.kind === 'vocabulary') {
      items.push({
        id: `definition:${column.id}`,
        label: field.label,
        sourceKind: 'definition',
        sourceId: definitionId,
        sourceLabel: definitionLabel,
        fieldKey: field.key,
        categoryKind: 'vocabulary',
        vocabularyId: category.vocabularyId,
        terms: [],
      })
      continue
    }
    if (category?.kind === 'embedded' && category.options.length > 0) {
      items.push({
        id: `definition:${column.id}`,
        label: field.label,
        sourceKind: 'definition',
        sourceId: definitionId,
        sourceLabel: definitionLabel,
        fieldKey: field.key,
        categoryKind: 'embedded',
        vocabularyId: null,
        terms: termsFromOptions(category.options),
      })
    }
  }
  return items
}

export function normalizeConfigurationVocabularies(
  items: ConfigurationVocabulary[],
): ConfigurationVocabulary[] {
  return [...items].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }),
  )
}

export async function loadConfigurationVocabularies(
  client: DataClient,
): Promise<ConfigurationVocabulary[]> {
  const modelKinds = await fetchModelKinds(client)
  const modelFieldsByKind = await Promise.all(
    modelKinds.map(async (kind) => ({
      kind,
      fields: await fetchModelFields(client, kind.key, true),
    })),
  )
  const modelItems = modelFieldsByKind.flatMap(({ kind, fields }) =>
    collectModelVocabularies(kind.key, kind.label, fields),
  )

  const schemaDefinitions = await listCanonicalDatasetSchemaDefinitions(client)
  const schemaItems: ConfigurationVocabulary[] = []
  for (const schema of schemaDefinitions) {
    const versions = await listCanonicalDatasetSchemaVersions(client, schema.id)
    if (versions.length === 0) continue
    const latestVersion = versions[0]
    const fields = await listCanonicalDatasetSchemaVersionFields(
      client,
      latestVersion.id,
    )
    schemaItems.push(
      ...collectSchemaVocabularies(schema.id, schema.name, fields),
    )
  }

  const definitions = await fetchSheetDefinitions(client)
  const definitionLabelById = new Map(
    definitions.map((definition) => [definition.id, definition.name]),
  )
  const versionRows = await client.list<SheetDefinitionVersionWire>(
    'sheet_definition_versions',
    '?order=definition_id.asc,version.desc&limit=2000',
  )
  const latestVersionByDefinition = new Map<
    string,
    SheetDefinitionVersionWire
  >()
  for (const version of versionRows) {
    if (!latestVersionByDefinition.has(version.definition_id)) {
      latestVersionByDefinition.set(version.definition_id, version)
    }
  }
  const definitionItems = [...latestVersionByDefinition.values()].flatMap(
    (version) => {
      const label = definitionLabelById.get(version.definition_id) ?? 'Sheet'
      try {
        const configuration = parseSheetDefinitionConfiguration(
          version.configuration,
        )
        return collectDefinitionVocabularies(
          version.definition_id,
          label,
          configuration,
        )
      } catch {
        return []
      }
    },
  )

  return normalizeConfigurationVocabularies([
    ...modelItems,
    ...schemaItems,
    ...definitionItems,
  ])
}
