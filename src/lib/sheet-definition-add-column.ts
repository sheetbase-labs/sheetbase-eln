/**
 * Adding a column a person types into to a sheet definition's layout: the
 * pure half of "Add column" on a template's sheet section. It returns a new
 * configuration with the column appended and shown last, and leaves the rest
 * (calculations, bindings, the order of every other column) as it was.
 */
import { parseSheetDefinitionConfiguration } from './sheet-definition'
import type { SheetDefinitionConfiguration } from './sheet-definition'

export const ADDABLE_COLUMN_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
] as const

export type AddableColumnType = (typeof ADDABLE_COLUMN_TYPES)[number]

export interface NewSheetColumn {
  label: string
  type: AddableColumnType
  /** The unit a number is stored in; numbers only. */
  unit?: string
  required: boolean
  /** The lowest and highest value a number may take; numbers only. */
  min?: number
  max?: number
}

/** A column key as the layout stores it: lower case words joined by underscores. */
export function columnKeyFor(
  label: string,
  taken: ReadonlySet<string>,
): string {
  const words = label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)

  const base = /^[a-z]/.test(words)
    ? words
    : `column_${words}`.replace(/_$/, '')

  let key = base
  let count = 2

  while (taken.has(key)) {
    key = `${base}_${count}`
    count += 1
  }

  return key
}

const NUMERIC: readonly AddableColumnType[] = ['integer', 'decimal']

export function addSheetColumn(
  configuration: SheetDefinitionConfiguration,
  column: NewSheetColumn,
  newId: () => string = () => crypto.randomUUID(),
): SheetDefinitionConfiguration {
  const label = column.label.trim()

  if (!label) throw new Error('A column needs a name.')

  if (
    configuration.columns.some(
      (existing) =>
        existing.field.label.trim().toLowerCase() === label.toLowerCase(),
    )
  )
    throw new Error('A column with that name is already in the sheet.')

  const numeric = NUMERIC.includes(column.type)
  const unit = numeric ? column.unit?.trim() : undefined
  const id = newId()

  const validation: { min?: number; max?: number } = {}

  if (numeric && column.min !== undefined) validation.min = column.min

  if (numeric && column.max !== undefined) validation.max = column.max

  const key = columnKeyFor(
    label,
    new Set(configuration.columns.map((existing) => existing.field.key)),
  )

  return parseSheetDefinitionConfiguration({
    ...configuration,
    columns: [
      ...configuration.columns,
      {
        id,
        field: {
          key,
          label,
          fieldId: id,
          category: null,
          nullable: !column.required,
          quantity: unit
            ? { kind: 'measurement', dimension: unit, storageUnit: unit }
            : null,
          lifecycle: 'active',
          validation,
          cardinality: 'one',
          computation: { mode: 'stored' },
          description: null,
          logicalType: column.type,
          defaultValue: null,
          relationship: null,
        },
        source: { kind: 'declared' },
      },
    ],
    presentation: {
      ...configuration.presentation,
      columnOrder: [...configuration.presentation.columnOrder, id],
    },
  })
}
