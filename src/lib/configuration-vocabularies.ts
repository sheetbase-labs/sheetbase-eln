import type { DataClient } from '#/lib/data-client'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'
import type { FieldOption } from '#/lib/field-definition'
import type { fetchModelFields } from '#/lib/model-fields'
import type { SheetDefinitionConfiguration } from '#/lib/sheet-definition'

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
  workspaceId: string,
): Promise<ConfigurationVocabulary[]> {
  const rows = await client.rpc<unknown[]>('list_configuration_vocabularies', {
    p_workspace_id: workspaceId,
    p_limit: 200,
    p_offset: 0,
  })
  return rows.map((row) => {
    const item = row as Record<string, unknown>
    return {
      id: String(item.id),
      label: String(item.label),
      sourceKind: item.source_kind as ConfigurationVocabularySourceKind,
      sourceId: String(item.source_id),
      sourceLabel: String(item.source_label),
      fieldKey: String(item.field_key),
      categoryKind: item.category_kind as 'embedded' | 'vocabulary',
      vocabularyId:
        typeof item.vocabulary_id === 'string' ? item.vocabulary_id : null,
      terms: Array.isArray(item.terms)
        ? item.terms.map((term) => {
            const value = term as Record<string, unknown>
            return {
              id: String(value.id),
              key: String(value.key),
              label: String(value.label),
              lifecycle: String(value.lifecycle),
            }
          })
        : [],
    }
  })
}
