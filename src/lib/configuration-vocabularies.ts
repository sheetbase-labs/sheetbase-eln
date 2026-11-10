import { z } from 'zod'

import type { DataClient } from '#/lib/data-client'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'
import type { FieldCategorySource, FieldOption } from '#/lib/field-definition'
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

export interface ConfigurationVocabularyPage {
  items: ConfigurationVocabulary[]
  hasMore: boolean
}

/** A stored option as the schema projection carries it; a bad field falls back
 * to the value the storage used before that field existed. */
const categoryOptionSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  displayOrder: z.number().catch(0),
  lifecycle: z.string().catch('active'),
})

/** The category source a schema field stored: a gallery, or a vocabulary. */
const categoryWireSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vocabulary'), vocabularyId: z.string() }),
  z.object({ kind: z.literal('embedded'), options: z.array(z.unknown()) }),
])

/** The field's stored category source, or null when it stored nothing usable. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the decode step: the field's category arrives as stored JSONB and `categoryWireSchema` below decides what it is.
function parseCategory(value: unknown): FieldCategorySource | null {
  const parsed = categoryWireSchema.safeParse(value)

  if (!parsed.success) return null

  if (parsed.data.kind === 'vocabulary') return parsed.data

  const options = parsed.data.options.flatMap((option) => {
    const item = categoryOptionSchema.safeParse(option)

    if (!item.success) return []

    return [
      {
        ...item.data,
        lifecycle:
          item.data.lifecycle === 'retired'
            ? ('retired' as const)
            : ('active' as const),
      },
    ]
  })

  return { kind: 'embedded', options }
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

/** One vocabulary term as `list_configuration_vocabularies` returns it. */
interface ConfigurationVocabularyTermWire {
  id: string
  key: string
  label: string
  lifecycle: string
}

/** One vocabulary the database lists, as it returns it. */
interface ConfigurationVocabularyRowWire {
  id: string
  label: string
  source_kind: ConfigurationVocabularySourceKind
  source_id: string
  source_label: string
  field_key: string
  category_kind: 'embedded' | 'vocabulary'
  vocabulary_id?: string | null
  terms?: ConfigurationVocabularyTermWire[]
}

/** The page `list_configuration_vocabularies` returns. */
interface ConfigurationVocabularyPageWire {
  items?: ConfigurationVocabularyRowWire[]
  hasMore?: boolean
}

export async function loadConfigurationVocabularies(
  client: DataClient,
  workspaceId: string,
  offset = 0,
): Promise<ConfigurationVocabularyPage> {
  const page = await client.rpc<ConfigurationVocabularyPageWire>(
    'list_configuration_vocabularies',
    {
      p_workspace_id: workspaceId,
      p_limit: 200,
      p_offset: offset,
    },
  )

  const items = (page.items ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    sourceKind: item.source_kind,
    sourceId: item.source_id,
    sourceLabel: item.source_label,
    fieldKey: item.field_key,
    categoryKind: item.category_kind,
    vocabularyId: item.vocabulary_id ?? null,
    terms: (item.terms ?? []).map((term) => ({
      id: term.id,
      key: term.key,
      label: term.label,
      lifecycle: term.lifecycle,
    })),
  }))

  return { items, hasMore: page.hasMore === true }
}
