/**
 * DATA-01 column mapping and fail-closed coercion against a pinned schema.
 */
import { z } from 'zod'

import { coerceDatasetCellValue } from './dataset-product'
import { FIELD_LOGICAL_TYPES } from './field-definition'
import type { ImportSheet } from './import-parse'
import type { ScientificColumnWire } from './scientific-sheet-data'

/** A value this mapper hands to a Dataset row or Record custom field. */
export type ImportCellValue = string | number | boolean | null | undefined

/** The scalar representations a coerced cell may take; anything else is refused. */
const importCellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

/** A pinned logical type; an unrecognised one is read as text, as it always was. */
const columnLogicalTypeSchema = z.enum(FIELD_LOGICAL_TYPES).catch('text')

/** Schema-field quantity metadata read from the pinned column wire. */
const quantityUnitMetadataSchema = z.looseObject({
  storageUnit: z.unknown().optional(),
  symbol: z.unknown().optional(),
  unit: z.unknown().optional(),
})

export interface ImportTargetField {
  id: string
  key?: string
  label: string
  logicalType: string
  nullable: boolean
  options?: Array<{ id: string; key?: string; label: string }>
  /** DSET-05.3 — the Schema field's unit, shown in the map step. */
  unit?: string | null
  /** Dataset field UUID vs Record model field name / title. */
  kind: 'dataset-field' | 'record-field' | 'record-title' | 'record-status'
}

export type ImportColumnMapping =
  | { source: string; kind: 'ignore' }
  | {
      source: string
      kind: 'field'
      field: ImportTargetField
      sourceUnit?: string | null
    }

/** Header annotations are suggestions, not a conversion or target-unit guess. */
export function importHeaderUnit(header: string): string | null {
  return (
    /(?:\(([^()]+)\)|\[([^[\]]+)\])\s*$/
      .exec(header)
      ?.slice(1)
      .find(Boolean)
      ?.trim() ?? null
  )
}

/** No conversion engine exists here. Fail closed instead of relabelling. */
export function importUnitError(
  field: ImportTargetField,
  sourceUnit?: string | null,
): string | null {
  if (field.logicalType !== 'integer' && field.logicalType !== 'decimal')
    return null
  const source = sourceUnit?.trim() || null
  const target = field.unit ?? null

  if (source === target) return null

  if (!source)
    return `Declare the source unit for ${field.label}. The Dataset stores ${target}; confirm that unit only if the file already uses it.`

  return `${field.label}: source unit ${source} does not match storage unit ${target ?? '(unitless)'}. Convert the source values to ${target ?? 'a unitless value'} before uploading, or choose a field with the correct storage unit. No automatic conversion is available.`
}

export interface ImportRowError {
  row: number
  source: string
  fieldId?: string
  code: string
  message: string
}

export interface MappedImportRow {
  rowId: string
  values: Record<string, ImportCellValue>
  title?: string
  status?: string
  /**
   * DSET-01.3 — optional sample/well key. When set, a Dataset import fills a
   * matching active planned row instead of creating a duplicate. Ignored for
   * Record imports.
   */
  plannedKey?: string
}

export interface MappedImport {
  schemaVersionId: string | null
  rows: MappedImportRow[]
  errors: ImportRowError[]
}

export function suggestImportMappings(
  headers: string[],
  fields: ImportTargetField[],
): ImportColumnMapping[] {
  return headers.map((source) => {
    const normalised = source.trim().toLowerCase()
    // `Capsid titre (×10¹⁰ vg/mL)` names the field `Capsid titre`; the
    // annotation is read separately as a suggested source unit.
    const bare = normalised.replace(/\s*(?:\([^()]+\)|\[[^[\]]+\])\s*$/, '')

    const field = fields.find((item) => {
      const labels = [item.label, item.key, item.id].flatMap((value) =>
        value ? [value.trim().toLowerCase()] : [],
      )

      return labels.includes(normalised) || labels.includes(bare)
    })

    return field ? { source, kind: 'field', field } : { source, kind: 'ignore' }
  })
}

export function datasetFieldsFromColumns(
  columns: ScientificColumnWire[],
): ImportTargetField[] {
  return [...columns]
    .sort((a, b) => a.display_order - b.display_order)
    .map((column) => ({
      id: column.id,
      key: column.field_name,
      label: column.label,
      logicalType: column.logical_type,
      nullable: column.nullable,
      options: column.options,
      unit: columnUnit(column.unit),
      kind: 'dataset-field' as const,
    }))
}

/** Read a display unit from a Schema field's quantity metadata. */
function columnUnit(quantity: ScientificColumnWire['unit']): string | null {
  const metadata = quantityUnitMetadataSchema.safeParse(quantity)

  if (!metadata.success) return null

  const declared =
    metadata.data.storageUnit ?? metadata.data.symbol ?? metadata.data.unit

  const decoded = z.string().safeParse(declared)

  return decoded.success && decoded.data.trim() ? decoded.data.trim() : null
}

export function recordFieldsFromModel(
  fields: Array<{
    fieldName: string
    label: string
    logicalType: string
    nullable: boolean
    lifecycle?: string
    options?: Array<{ id: string; key?: string; label: string }>
  }>,
): ImportTargetField[] {
  const title: ImportTargetField = {
    id: 'title',
    key: 'title',
    label: 'Record name',
    logicalType: 'text',
    nullable: false,
    kind: 'record-title',
  }

  const status: ImportTargetField = {
    id: 'status',
    key: 'status',
    label: 'Status',
    logicalType: 'text',
    nullable: true,
    kind: 'record-status',
  }

  const model = fields.flatMap((field) =>
    field.lifecycle === 'retired'
      ? []
      : [
          {
            id: field.fieldName,
            key: field.fieldName,
            label: field.label,
            logicalType: field.logicalType,
            nullable: field.nullable,
            options: field.options,
            kind: 'record-field' as const,
          },
        ],
  )

  return [title, status, ...model]
}

export function mapImportSheet(
  sheet: ImportSheet,
  mappings: ImportColumnMapping[],
  schemaVersionId: string | null,
  rowIdFactory: () => string = () => crypto.randomUUID(),
): MappedImport {
  const errors: ImportRowError[] = []

  const rows = sheet.rows.map((sourceRow, index) => {
    const values: Record<string, ImportCellValue> = {}
    let title: string | undefined
    let status: string | undefined

    for (const mapping of mappings) {
      if (mapping.kind === 'ignore') continue
      const raw = sourceRow[mapping.source] ?? ''

      try {
        const unitError = importUnitError(
          mapping.field,
          mapping.sourceUnit ?? importHeaderUnit(mapping.source),
        )

        if (unitError) throw new Error(unitError)
        const coerced = coerceImportValue(mapping.field, raw)

        if (mapping.field.kind === 'record-title') {
          title = String(coerced ?? '')
        } else if (mapping.field.kind === 'record-status') {
          status =
            coerced === null || coerced === undefined
              ? undefined
              : String(coerced)
        } else {
          values[mapping.field.id] = coerced
        }
      } catch (error) {
        errors.push({
          row: index + 1,
          source: mapping.source,
          fieldId: mapping.field.id,
          code: 'coercion_failed',
          message: error instanceof Error ? error.message : 'Invalid value.',
        })
      }
    }

    return { rowId: rowIdFactory(), values, title, status }
  })

  return { schemaVersionId, rows, errors }
}

export function coerceImportValue(
  field: ImportTargetField,
  raw: string,
): ImportCellValue {
  const column: ScientificColumnWire = {
    id: field.id,
    field_name: field.key ?? field.id,
    label: field.label,
    display_order: 0,
    logical_type: columnLogicalTypeSchema.parse(field.logicalType),
    nullable: field.nullable,
    unit: null,
    validation: {},
    width: null,
    options: (field.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      display_order: 0,
    })),
  }

  const trimmed = raw.trim()

  if (trimmed === '') {
    if (!field.nullable && field.kind !== 'record-status') {
      throw new Error(`${field.label} is required.`)
    }

    return field.kind === 'record-status' ? undefined : null
  }

  switch (field.logicalType) {
    case 'integer':
    case 'decimal':
    case 'boolean':
      return importCellValueSchema.parse(
        coerceDatasetCellValue(column, trimmed),
      )
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new Error(`Invalid date: ${field.label}`)
      }

      return trimmed
    case 'timestamp':
      if (
        !/^\d{4}-\d{2}-\d{2}T/.test(trimmed) ||
        Number.isNaN(Date.parse(trimmed))
      ) {
        throw new Error(`Invalid timestamp: ${field.label}`)
      }

      return trimmed
    case 'category': {
      const option = (field.options ?? []).find(
        (item) =>
          item.id === trimmed ||
          item.key === trimmed ||
          item.label.toLowerCase() === trimmed.toLowerCase(),
      )

      if (!option) throw new Error(`Invalid category: ${field.label}`)

      return option.id
    }

    case 'reference':
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          trimmed,
        )
      ) {
        throw new Error(`Invalid reference: ${field.label}`)
      }

      return trimmed
    default:
      return trimmed
  }
}

export function assertPinnedSchemaVersion(
  expectedSchemaVersionId: string | null | undefined,
  actualSchemaVersionId: string | null | undefined,
): void {
  if (!expectedSchemaVersionId || !actualSchemaVersionId) return

  if (expectedSchemaVersionId !== actualSchemaVersionId) {
    throw new Error(
      'This Dataset Schema Version changed. Refresh the mapping and try again.',
    )
  }
}
