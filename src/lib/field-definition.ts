import { z } from 'zod'

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

/**
 * A value a Model or Dataset field's opaque `unit` and `validation` columns
 * hold, as PostgreSQL JSONB stores it.
 */
export type PersistedFieldJson =
  | string
  | number
  | boolean
  | null
  | PersistedFieldJson[]
  | { [key: string]: PersistedFieldJson }

const persistedFieldJsonSchema: z.ZodType<PersistedFieldJson> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(persistedFieldJsonSchema),
    z.record(z.string(), persistedFieldJsonSchema),
  ]),
)

const persistedFieldJsonObjectSchema = z.record(
  z.string(),
  persistedFieldJsonSchema,
)

export interface FieldValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Extensions hold the per-field JSONB rule metadata owned by the field's scientific type; each reader decodes the keys it knows (readings-data parses systemFlags.out_of_range).
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

/** Source metadata persisted by the current Model storage. Embedded options
 * remain in `model_field_options`, so they are joined by the projection. */
export type PersistedModelFieldCategorySource =
  { kind: 'embedded' } | { kind: 'vocabulary'; vocabularyId: string }

export type FieldRelationshipTarget =
  | { kind: 'model'; modelKey: string }
  | { kind: 'dataset-schema'; schemaId: string }

export interface FieldRelationship {
  target: FieldRelationshipTarget
  cardinality: FieldCardinality
}

export type FieldComputation =
  { mode: 'stored' } | { mode: 'computed'; expressionId?: string }

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
  unit: unknown
  quantity?: FieldQuantityDefinition | null
  validation: unknown
  cardinality?: FieldCardinality
  categorySource?: PersistedModelFieldCategorySource | null
  relationship?: FieldRelationship | null
  lifecycle: FieldLifecycle
  options: FieldOption[]
}

/** Current Dataset-schema field shape used by the compatibility adapter.
 * Dataset relationship edges remain the source of reference targets. */
export interface ExistingDatasetSchemaFieldLike {
  id: string
  slug: string
  label: string
  description: string | null
  logicalType: FieldLogicalType
  nullable: boolean
  defaultValue: unknown
  unit: unknown
  quantity?: FieldQuantityDefinition | null
  validation: unknown
  cardinality?: FieldCardinality
  categorySource?: FieldCategorySource | null
  relationship?: FieldRelationship | null
  lifecycle: 'active' | 'retired'
  options?: FieldOption[]
}

export interface FieldContractIssue {
  path: keyof FieldDefinition | 'category'
  message: string
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0
}

/** `value` as a stored JSON string, or null when it holds another JSON type. */
function persistedString(value: PersistedFieldJson | undefined): string | null {
  const parsed = z.string().safeParse(value)

  return parsed.success ? parsed.data : null
}

/** `value` as a stored JSON number, or null when it holds another JSON type. */
function persistedNumber(value: PersistedFieldJson | undefined): number | null {
  const parsed = z.number().safeParse(value)

  return parsed.success ? parsed.data : null
}

/** `value` as stored JSON strings, or null when any entry is another type. */
function persistedStrings(
  value: PersistedFieldJson | undefined,
): string[] | null {
  const parsed = z.array(z.string()).safeParse(value)

  return parsed.success ? parsed.data : null
}

/**
 * Compatibility projection for the current opaque Model `unit` JSON.
 * CORE-01.3 may improve production storage, but existing values are not
 * reinterpreted silently. Missing semantic metadata is preserved as an
 * intentionally weak legacy projection until explicitly configured.
 */
export function fieldQuantityFromPersistedUnit(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This adapter is the decode boundary for the unit column's opaque JSONB: it parses that JSON with persistedFieldJsonObjectSchema and every read below is a decoded value.
  value: unknown,
): FieldQuantityDefinition | null {
  const parsed = persistedFieldJsonObjectSchema.safeParse(value)

  if (!parsed.success) return null

  const unit = parsed.data
  const symbol = persistedString(unit.symbol)

  const storageUnit =
    persistedString(unit.storageUnit) ??
    persistedString(unit.canonicalUnit) ??
    symbol

  if (!storageUnit) return null

  const dimension = persistedString(unit.dimension) ?? 'legacy-unspecified'

  const kind = persistedString(unit.kind) ?? dimension

  const quantity: FieldQuantityDefinition = {
    kind,
    dimension,
    storageUnit,
  }

  const allowedInputUnits =
    persistedStrings(unit.allowedInputUnits) ??
    persistedStrings(unit.allowedUnits)

  if (allowedInputUnits !== null) {
    quantity.allowedInputUnits = allowedInputUnits
  }

  const preferredDisplayUnit = persistedString(unit.preferredDisplayUnit)

  if (preferredDisplayUnit !== null) {
    quantity.preferredDisplayUnit = preferredDisplayUnit
  }

  return quantity
}

function asValidation(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This adapter is the decode boundary for the validation column's opaque JSONB: it parses that JSON with persistedFieldJsonObjectSchema and every read below is a decoded value.
  value: unknown,
): FieldValidation {
  const parsed = persistedFieldJsonObjectSchema.safeParse(value)
  const validation: FieldValidation = {}

  if (!parsed.success) return validation

  const extensions: Record<string, PersistedFieldJson> = {}

  for (const [key, item] of Object.entries(parsed.data)) {
    const number = persistedNumber(item)
    const text = persistedString(item)

    if (
      (key === 'min' ||
        key === 'max' ||
        key === 'minLength' ||
        key === 'maxLength') &&
      number !== null
    ) {
      validation[key] = number
    } else if ((key === 'pattern' || key === 'regex') && text !== null) {
      validation.pattern = text
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
  const persistedValidation = persistedFieldJsonObjectSchema.safeParse(
    field.validation,
  )

  const targetModelKey = persistedValidation.success
    ? persistedString(persistedValidation.data.targetModelKey)
    : null

  const cardinality = field.cardinality ?? 'one'

  return {
    fieldId: field.id,
    key: field.fieldName,
    label: field.label,
    description: field.description,
    logicalType: field.logicalType,
    nullable: field.nullable,
    defaultValue: field.defaultValue,
    cardinality,
    quantity: field.quantity ?? fieldQuantityFromPersistedUnit(field.unit),
    validation: asValidation(field.validation),
    category:
      field.logicalType === 'category'
        ? field.categorySource?.kind === 'vocabulary'
          ? field.categorySource
          : { kind: 'embedded', options: field.options }
        : null,
    relationship:
      field.logicalType === 'reference' && field.relationship !== undefined
        ? field.relationship
        : field.logicalType === 'reference' && targetModelKey !== null
          ? {
              target: { kind: 'model', modelKey: targetModelKey },
              cardinality,
            }
          : null,
    computation: { mode: 'stored' },
    lifecycle: field.lifecycle,
  }
}

/**
 * Compatibility projection for the Dataset-schema registry. A Dataset field
 * uses `slug` as its durable row-shape key. Reference targets are supplied
 * from the registry's first-class relationship edge rather than inferred from
 * an opaque validation property. Current Dataset rows are scalar, so the
 * projection deliberately keeps their cardinality at `one`.
 */
export function fieldDefinitionFromDatasetSchemaField(
  field: ExistingDatasetSchemaFieldLike,
): FieldDefinition {
  return {
    fieldId: field.id,
    key: field.slug,
    label: field.label,
    description: field.description,
    logicalType: field.logicalType,
    nullable: field.nullable,
    defaultValue: field.defaultValue,
    cardinality: field.cardinality ?? 'one',
    quantity: field.quantity ?? fieldQuantityFromPersistedUnit(field.unit),
    validation: asValidation(field.validation),
    category:
      field.logicalType === 'category'
        ? (field.categorySource ?? {
            kind: 'embedded',
            options: field.options ?? [],
          })
        : null,
    relationship:
      field.logicalType === 'reference' ? (field.relationship ?? null) : null,
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
      message:
        'Quantity semantics are only valid for integer or decimal fields.',
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
      if (
        !nonBlank(option.id) ||
        !nonBlank(option.key) ||
        !nonBlank(option.label)
      ) {
        issues.push({
          path: 'category',
          message: 'Category option id, key and label must be non-empty.',
        })
        break
      }

      if (optionIds.has(option.id) || optionKeys.has(option.key)) {
        issues.push({
          path: 'category',
          message:
            'Category option ids and keys must be unique within a field.',
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
