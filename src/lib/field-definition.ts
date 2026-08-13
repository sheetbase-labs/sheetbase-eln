export const FIELD_LOGICAL_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
  'reference',
] as const

export type FieldLogicalType = (typeof FIELD_LOGICAL_TYPES)[number]
export type FieldLifecycle = 'draft' | 'backfilling' | 'active' | 'retired'
export type FieldCardinality = 'one' | 'many'

/**
 * Scientific quantity semantics for numeric fields.
 *
 * `kind` preserves scientific meaning (for example viability vs MOI), while
 * `dimension` supports dimensional/unit compatibility. Governed values are
 * persisted in one canonical storage unit; input/display units may differ.
 */
export interface FieldQuantityDefinition {
  kind: string
  dimension: string
  storageUnit: string
  allowedInputUnits?: string[]
  preferredDisplayUnit?: string
}

export interface FieldValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  extensions?: Record<string, unknown>
}

export interface FieldOption {
  id: string
  key: string
  label: string
  displayOrder: number
  lifecycle: 'active' | 'retired'
}

export type FieldCategorySource =
  | { kind: 'embedded'; options: FieldOption[] }
  | { kind: 'vocabulary'; vocabularyId: string }

export type FieldRelationshipTarget =
  | { kind: 'model'; modelKey: string }
  | { kind: 'dataset-schema'; schemaId: string }

export interface FieldRelationship {
  target: FieldRelationshipTarget
  cardinality: FieldCardinality
}

export type FieldComputation =
  | { mode: 'stored' }
  | { mode: 'computed'; expressionId?: string }

/**
 * Canonical semantic field contract shared by Models and Dataset Schemas.
 * Durable dependencies bind to fieldId. key is the stable API/storage key;
 * label is presentation-only.
 *
 * Compatibility rule: defaultValue === null means no explicit default in the
 * current Model/scientific storage contracts.
 */
export interface FieldDefinition {
  fieldId: string
  key: string
  label: string
  description: string | null
  logicalType: FieldLogicalType
  nullable: boolean
  defaultValue: unknown
  cardinality: FieldCardinality
  quantity: FieldQuantityDefinition | null
  validation: FieldValidation
  category: FieldCategorySource | null
  relationship: FieldRelationship | null
  computation: FieldComputation
  lifecycle: FieldLifecycle
}

/** Current production Model-field shape used by the compatibility adapter. */
export interface ExistingModelFieldLike {
  id: string
  fieldName: string
  label: string
  description: string | null
  logicalType: FieldLogicalType
  nullable: boolean
  defaultValue: unknown
  unit: Record<string, unknown> | null
  validation: Record<string, unknown>
  lifecycle: FieldLifecycle
  options: FieldOption[]
}

export interface FieldContractIssue {
  path: keyof FieldDefinition | 'category'
  message: string
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0
}

/**
 * Compatibility projection for the current opaque Model `unit` JSON.
 * CORE-01.3 may improve production storage, but existing values are not
 * reinterpreted silently. Missing semantic metadata is preserved as an
 * intentionally weak legacy projection until explicitly configured.
 */
function quantityFromLegacyUnit(
  value: Record<string, unknown> | null,
): FieldQuantityDefinition | null {
  if (!value) return null

  const symbol = typeof value.symbol === 'string' ? value.symbol : null
  const storageUnit =
    typeof value.storageUnit === 'string'
      ? value.storageUnit
      : typeof value.canonicalUnit === 'string'
        ? value.canonicalUnit
        : symbol
  if (!storageUnit) return null

  const dimension =
    typeof value.dimension === 'string' ? value.dimension : 'legacy-unspecified'
  const kind = typeof value.kind === 'string' ? value.kind : dimension

  const quantity: FieldQuantityDefinition = {
    kind,
    dimension,
    storageUnit,
  }

  if (
    Array.isArray(value.allowedInputUnits) &&
    value.allowedInputUnits.every((item) => typeof item === 'string')
  ) {
    quantity.allowedInputUnits = value.allowedInputUnits
  } else if (
    Array.isArray(value.allowedUnits) &&
    value.allowedUnits.every((item) => typeof item === 'string')
  ) {
    quantity.allowedInputUnits = value.allowedUnits
  }

  if (typeof value.preferredDisplayUnit === 'string') {
    quantity.preferredDisplayUnit = value.preferredDisplayUnit
  }

  return quantity
}

function asValidation(value: Record<string, unknown>): FieldValidation {
  const validation: FieldValidation = {}
  const extensions: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'min' || key === 'max') && typeof item === 'number') {
      validation[key] = item
    } else if (
      (key === 'minLength' || key === 'maxLength') &&
      typeof item === 'number'
    ) {
      validation[key] = item
    } else if (key === 'pattern' && typeof item === 'string') {
      validation.pattern = item
    } else if (key !== 'targetModelKey') {
      extensions[key] = item
    }
  }
  if (Object.keys(extensions).length > 0) validation.extensions = extensions
  return validation
}

/** Lossless-as-possible semantic adapter for the current Model-field contract. */
export function fieldDefinitionFromModelField(
  field: ExistingModelFieldLike,
): FieldDefinition {
  const targetModelKey = field.validation.targetModelKey
  return {
    fieldId: field.id,
    key: field.fieldName,
    label: field.label,
    description: field.description,
    logicalType: field.logicalType,
    nullable: field.nullable,
    defaultValue: field.defaultValue,
    cardinality: 'one',
    quantity: quantityFromLegacyUnit(field.unit),
    validation: asValidation(field.validation),
    category:
      field.logicalType === 'category'
        ? { kind: 'embedded', options: field.options }
        : null,
    relationship:
      field.logicalType === 'reference' && typeof targetModelKey === 'string'
        ? {
            target: { kind: 'model', modelKey: targetModelKey },
            cardinality: 'one',
          }
        : null,
    computation: { mode: 'stored' },
    lifecycle: field.lifecycle,
  }
}

export function validateFieldDefinition(
  field: FieldDefinition,
): FieldContractIssue[] {
  const issues: FieldContractIssue[] = []
  if (!nonBlank(field.fieldId))
    issues.push({ path: 'fieldId', message: 'fieldId must be non-empty.' })
  if (!nonBlank(field.key))
    issues.push({ path: 'key', message: 'key must be non-empty.' })
  if (!nonBlank(field.label))
    issues.push({ path: 'label', message: 'label must be non-empty.' })

  if (field.cardinality === 'many' && field.defaultValue !== null) {
    issues.push({
      path: 'defaultValue',
      message: 'Many-valued fields do not support explicit defaults yet.',
    })
  }

  if (
    field.quantity !== null &&
    field.logicalType !== 'integer' &&
    field.logicalType !== 'decimal'
  ) {
    issues.push({
      path: 'quantity',
      message: 'Quantity semantics are only valid for integer or decimal fields.',
    })
  }

  if (field.quantity !== null) {
    if (
      !nonBlank(field.quantity.kind) ||
      !nonBlank(field.quantity.dimension) ||
      !nonBlank(field.quantity.storageUnit)
    ) {
      issues.push({
        path: 'quantity',
        message: 'Quantity kind, dimension and storageUnit must be non-empty.',
      })
    }
  }

  if (field.logicalType === 'category' && field.category === null) {
    issues.push({
      path: 'category',
      message: 'Category fields require embedded options or a vocabulary.',
    })
  }
  if (field.logicalType !== 'category' && field.category !== null) {
    issues.push({
      path: 'category',
      message: 'Only category fields may define a category source.',
    })
  }

  if (field.category?.kind === 'embedded') {
    const optionIds = new Set<string>()
    const optionKeys = new Set<string>()
    for (const option of field.category.options) {
      if (!nonBlank(option.id) || !nonBlank(option.key) || !nonBlank(option.label)) {
        issues.push({
          path: 'category',
          message: 'Category option id, key and label must be non-empty.',
        })
        break
      }
      if (optionIds.has(option.id) || optionKeys.has(option.key)) {
        issues.push({
          path: 'category',
          message: 'Category option ids and keys must be unique within a field.',
        })
        break
      }
      optionIds.add(option.id)
      optionKeys.add(option.key)
    }
  }

  if (
    field.category?.kind === 'vocabulary' &&
    !nonBlank(field.category.vocabularyId)
  ) {
    issues.push({
      path: 'category',
      message: 'Vocabulary-backed categories require a vocabularyId.',
    })
  }

  if (field.logicalType === 'reference' && field.relationship === null) {
    issues.push({
      path: 'relationship',
      message: 'Reference fields require an explicit relationship target.',
    })
  }
  if (field.logicalType !== 'reference' && field.relationship !== null) {
    issues.push({
      path: 'relationship',
      message: 'Only reference fields may define a relationship target.',
    })
  }
  if (
    field.relationship !== null &&
    field.relationship.cardinality !== field.cardinality
  ) {
    issues.push({
      path: 'cardinality',
      message: 'Field and relationship cardinality must agree.',
    })
  }

  if (field.computation.mode === 'computed' && field.defaultValue !== null) {
    issues.push({
      path: 'defaultValue',
      message: 'Computed fields cannot define an explicit default.',
    })
  }

  return issues
}

export function assertFieldDefinition(field: FieldDefinition): FieldDefinition {
  const issues = validateFieldDefinition(field)
  if (issues.length > 0) {
    throw new Error(
      `Invalid FieldDefinition: ${issues.map(({ path, message }) => `${path}: ${message}`).join(' ')}`,
    )
  }
  return field
}
