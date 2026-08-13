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

export interface FieldUnitDefinition {
  symbol?: string
  dimension?: string
  canonicalUnit?: string
  allowedUnits?: string[]
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
 * Canonical semantic field contract shared by Models, Dataset schemas and
 * sheet columns. Durable dependencies bind to fieldId. key is the stable
 * human-facing API/storage key; label is presentation-only.
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
  unit: FieldUnitDefinition | null
  validation: FieldValidation
  options: FieldOption[]
  relationship: FieldRelationship | null
  computation: FieldComputation
  lifecycle: FieldLifecycle
}

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
  path: keyof FieldDefinition | 'options'
  message: string
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0
}

function asUnit(value: Record<string, unknown> | null): FieldUnitDefinition | null {
  if (!value) return null
  const unit: FieldUnitDefinition = {}
  if (typeof value.symbol === 'string') unit.symbol = value.symbol
  if (typeof value.dimension === 'string') unit.dimension = value.dimension
  if (typeof value.canonicalUnit === 'string') unit.canonicalUnit = value.canonicalUnit
  if (
    Array.isArray(value.allowedUnits) &&
    value.allowedUnits.every((item) => typeof item === 'string')
  ) {
    unit.allowedUnits = value.allowedUnits
  }
  return unit
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

/** Lossless semantic adapter for the current Model-field contract. */
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
    unit: asUnit(field.unit),
    validation: asValidation(field.validation),
    options: field.options,
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
    field.unit !== null &&
    field.logicalType !== 'integer' &&
    field.logicalType !== 'decimal'
  ) {
    issues.push({
      path: 'unit',
      message: 'Units are only valid for integer or decimal fields.',
    })
  }

  if (field.logicalType !== 'category' && field.options.length > 0) {
    issues.push({
      path: 'options',
      message: 'Controlled vocabulary options require logicalType=category.',
    })
  }

  const optionIds = new Set<string>()
  const optionKeys = new Set<string>()
  for (const option of field.options) {
    if (!nonBlank(option.id) || !nonBlank(option.key) || !nonBlank(option.label)) {
      issues.push({
        path: 'options',
        message: 'Category option id, key and label must be non-empty.',
      })
      break
    }
    if (optionIds.has(option.id) || optionKeys.has(option.key)) {
      issues.push({
        path: 'options',
        message: 'Category option ids and keys must be unique within a field.',
      })
      break
    }
    optionIds.add(option.id)
    optionKeys.add(option.key)
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
