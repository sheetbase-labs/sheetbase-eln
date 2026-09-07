import type { DataClient } from '#/lib/data-client'
import { fieldDefinitionFromModelField } from '#/lib/field-definition'
import type {
  FieldCardinality,
  FieldDefinition,
  FieldLogicalType,
  FieldOption,
  PersistedModelFieldCategorySource,
  FieldQuantityDefinition,
  FieldRelationship,
} from '#/lib/field-definition'
import {
  fieldDisplayUnit,
  parseQuantityNumericValue,
  validateFieldValue,
} from '#/lib/field-value-validation'

export type ModelFieldLogicalType = FieldLogicalType

export type ModelFieldOption = FieldOption

export interface ModelFieldDefinition {
  id: string
  modelKey: string
  fieldName: string
  label: string
  description: string | null
  displayOrder: number
  logicalType: ModelFieldLogicalType
  nullable: boolean
  defaultValue: unknown
  unit: Record<string, unknown> | null
  quantity?: FieldQuantityDefinition | null
  validation: Record<string, unknown>
  cardinality?: FieldCardinality
  categorySource?: PersistedModelFieldCategorySource | null
  relationship?: FieldRelationship | null
  lifecycle: 'draft' | 'backfilling' | 'active' | 'retired'
  options: ModelFieldOption[]
  /** Canonical semantic projection of this persisted Model field. */
  definition?: FieldDefinition
}

export interface ModelKind {
  key: string
  label: string
  identityTable: string
}

export interface ModelFieldRecordValues {
  customFields: Record<string, unknown>
  metadataVersion: number
  locked: boolean
}

interface DefinitionWire {
  id: string
  kind: string
  field_name: string
  label: string
  description: string | null
  display_order: number
  logical_type: ModelFieldLogicalType
  nullable: boolean
  default_value: unknown
  unit: Record<string, unknown> | null
  quantity: FieldQuantityDefinition | null
  validation: Record<string, unknown>
  cardinality: FieldCardinality
  category_source: PersistedModelFieldCategorySource | null
  relationship: FieldRelationship | null
  lifecycle: ModelFieldDefinition['lifecycle']
}

interface OptionWire {
  id: string
  definition_id: string
  key: string
  label: string
  display_order: number
  lifecycle: ModelFieldOption['lifecycle']
}

export async function fetchModelFields(
  client: DataClient,
  modelKey: string,
  includeRetired = false,
): Promise<ModelFieldDefinition[]> {
  const lifecycle = includeRetired ? 'in.(active,retired)' : 'eq.active'
  const definitions = await client.list<DefinitionWire>(
    'record_field_definitions',
    `?kind=eq.${modelKey}&lifecycle=${lifecycle}&order=display_order.asc,field_name.asc`,
  )
  if (definitions.length === 0) return []
  const options = await client.list<OptionWire>(
    'model_field_options',
    `?definition_id=in.(${definitions.map(({ id }) => id).join(',')})&order=display_order.asc,key.asc`,
  )
  const optionsByDefinition = new Map<string, OptionWire[]>()
  for (const option of options) {
    optionsByDefinition.set(option.definition_id, [
      ...(optionsByDefinition.get(option.definition_id) ?? []),
      option,
    ])
  }
  return definitions.map((definition) => {
    const modelField = {
      id: definition.id,
      modelKey: definition.kind,
      fieldName: definition.field_name,
      label: definition.label,
      description: definition.description,
      displayOrder: definition.display_order,
      logicalType: definition.logical_type,
      nullable: definition.nullable,
      defaultValue: definition.default_value,
      unit: definition.unit,
      quantity: definition.quantity,
      validation: definition.validation,
      cardinality: definition.cardinality,
      categorySource: definition.category_source,
      relationship: definition.relationship,
      lifecycle: definition.lifecycle,
      options: (optionsByDefinition.get(definition.id) ?? []).map((option) => ({
        id: option.id,
        key: option.key,
        label: option.label,
        displayOrder: option.display_order,
        lifecycle: option.lifecycle,
      })),
    }
    return {
      ...modelField,
      definition: fieldDefinitionFromModelField(modelField),
    }
  })
}

export function fetchModelKinds(client: DataClient): Promise<ModelKind[]> {
  return client
    .list<{ key: string; label: string; identity_table: string }>(
      'model_kinds',
      '?order=label.asc',
    )
    .then((rows) =>
      rows.map((row) => ({
        key: row.key,
        label: row.label,
        identityTable: row.identity_table,
      })),
    )
}

export async function fetchRecordModelFieldValues(
  client: DataClient,
  recordId: string,
): Promise<ModelFieldRecordValues> {
  const rows = await client.list<{
    custom_fields: Record<string, unknown>
    metadata_version: number
    locked_at: string | null
  }>(
    'records',
    `?id=eq.${encodeURIComponent(recordId)}&select=custom_fields,metadata_version,locked_at`,
  )
  const row = rows.at(0)
  if (!row) throw new Error('Record not found.')
  return {
    customFields: row.custom_fields,
    metadataVersion: row.metadata_version,
    locked: row.locked_at !== null,
  }
}

export function updateRecordModelFieldValues(
  client: DataClient,
  recordId: string,
  expectedMetadataVersion: number,
  values: Record<string, unknown>,
): Promise<unknown> {
  return client.rpc('update_record_custom_fields', {
    p_record_id: recordId,
    p_expected_metadata_version: expectedMetadataVersion,
    p_values: values,
  })
}

export async function fetchModelFieldsWithUsage(
  client: DataClient,
  modelKey: string,
): Promise<Array<ModelFieldDefinition & { usageCount: number }>> {
  const fields = await fetchModelFields(client, modelKey, true)
  return Promise.all(
    fields.map(async (field) => ({
      ...field,
      usageCount: Number(
        await client.rpc<number>('model_field_usage', {
          p_definition_id: field.id,
        }),
      ),
    })),
  )
}

export function modelFieldColumnId(fieldName: string): string {
  return `custom:${fieldName}`
}

export function definitionOfModelField(
  definition: ModelFieldDefinition,
): FieldDefinition {
  return definition.definition ?? fieldDefinitionFromModelField(definition)
}

export function parseModelFieldInput(
  definition: ModelFieldDefinition,
  value: string | boolean,
): unknown {
  if (typeof value === 'boolean') return value
  if (value === '') return definition.nullable ? null : value
  if (
    definition.logicalType === 'integer' ||
    definition.logicalType === 'decimal'
  ) {
    // MODEL-02: same quantity-aware numeric coercion (`12.5 mg/mL` → 12.5)
    // the Sheet cell parser uses; unparseable input fails closed downstream.
    const parsed = parseQuantityNumericValue(
      definitionOfModelField(definition),
      value,
    )
    if (typeof parsed === 'number') return parsed
    return value
  }
  return value
}

/**
 * Client-side value contract for Record input. Same kernel
 * (`validateFieldValue`) the Sheet cell validator uses; the server remains
 * authoritative for reference existence and retired-option grandfathering.
 */
export function validateModelFieldValue(
  definition: ModelFieldDefinition,
  value: unknown,
): string | null {
  return validateFieldValue(definitionOfModelField(definition), value)
}

export function modelFieldValuesFromInput(
  definitions: ModelFieldDefinition[],
  values: Record<string, string | boolean>,
  omitBlank: boolean,
): Record<string, unknown> {
  return Object.fromEntries(
    definitions.flatMap((definition) => {
      const hasValue = Object.prototype.hasOwnProperty.call(
        values,
        definition.fieldName,
      )
      if (omitBlank && !hasValue) {
        return definition.logicalType === 'boolean' &&
          !definition.nullable &&
          definition.defaultValue === null
          ? [[definition.fieldName, false]]
          : []
      }
      const value =
        values[definition.fieldName] ??
        (definition.logicalType === 'boolean' ? false : '')
      if (omitBlank && value === '') return []
      return [[definition.fieldName, parseModelFieldInput(definition, value)]]
    }),
  )
}

export function displayModelFieldValue(
  definition: ModelFieldDefinition,
  value: unknown,
): string {
  if (value === null || value === undefined || value === '') return '—'
  if (definition.logicalType === 'boolean') return value === true ? 'Yes' : 'No'
  if (definition.logicalType === 'category') {
    return (
      definition.options.find(
        (option) => option.key === value || option.id === value,
      )?.label ?? String(value)
    )
  }
  // MODEL-02: governed quantity display unit wins; legacy opaque unit
  // symbols remain the fallback until semantics are configured.
  const legacySymbol =
    typeof definition.unit?.symbol === 'string' ? definition.unit.symbol : null
  const unit = fieldDisplayUnit(
    definitionOfModelField(definition),
    legacySymbol,
  )
  return unit ? `${String(value)} ${unit}` : String(value)
}

export interface ModelFieldSemanticsInput {
  quantity: FieldQuantityDefinition | null
  cardinality: FieldCardinality
  categorySource: PersistedModelFieldCategorySource | null
  relationship: FieldRelationship | null
}

/**
 * MODEL-02: wire the 0060 semantic-configuration RPC. Draft-only on the
 * server (active contracts are immutable), so authoring runs it between
 * `create_model_field` and `activate_model_field`.
 */
export function configureModelFieldSemantics(
  client: DataClient,
  definitionId: string,
  semantics: ModelFieldSemanticsInput,
): Promise<unknown> {
  return client.rpc('configure_model_field_semantics', {
    p_definition_id: definitionId,
    p_quantity: semantics.quantity,
    p_cardinality: semantics.cardinality,
    p_category_source: semantics.categorySource,
    p_relationship: semantics.relationship,
  })
}

/**
 * The server stores text patterns under the `regex` validation key while
 * the kernel exposes them as `pattern` — map once at the write boundary.
 */
export function modelFieldValidationForServer(
  validation: Record<string, unknown>,
): Record<string, unknown> {
  const { pattern, ...rest } = validation
  if (typeof pattern === 'string' && pattern) {
    return { ...rest, regex: pattern }
  }
  return validation
}

export interface CreateModelFieldWithSemanticsInput {
  workspaceId: string
  modelKey: string
  fieldName: string
  label: string
  logicalType: ModelFieldLogicalType
  nullable: boolean
  defaultValue: unknown
  validation: Record<string, unknown>
  unit: Record<string, unknown> | null
  description: string | null
  options: Array<{ key: string; label: string }>
  semantics: ModelFieldSemanticsInput
}

/**
 * MODEL-02 authoring flow using only existing RPCs: draft the field,
 * configure governed semantics (quantity/category source/relationship),
 * create embedded options, then activate. Mirrors what
 * `create_and_activate_model_field` does for the simple case.
 */
export async function createModelFieldWithSemantics(
  client: DataClient,
  input: CreateModelFieldWithSemanticsInput,
): Promise<unknown> {
  const created = await client.rpc<{ id: string }>('create_model_field', {
    p_workspace_id: input.workspaceId,
    p_model_key: input.modelKey,
    p_field_name: input.fieldName,
    p_label: input.label,
    p_logical_type: input.logicalType,
    p_nullable: input.nullable,
    p_default_value: input.defaultValue,
    p_validation: modelFieldValidationForServer(input.validation),
    p_unit: input.unit,
    p_description: input.description,
  })
  await configureModelFieldSemantics(client, created.id, input.semantics)
  let position = 0
  for (const option of input.options) {
    position += 1
    await client.rpc('create_model_field_option', {
      p_definition_id: created.id,
      p_key: option.key,
      p_label: option.label,
      p_display_order: position,
    })
  }
  return client.rpc('activate_model_field', {
    p_definition_id: created.id,
  })
}
