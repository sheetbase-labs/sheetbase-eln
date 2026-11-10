import { createElement } from 'react'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type {
  ModelFieldDefinition,
  ModelFieldRecordValues,
} from '#/lib/model-fields'
import { modelFieldColumnId } from '#/lib/model-fields'
import { addedFieldDisplay, addedFieldSortValue } from './added-field-values'
import { AddedFieldValueCell } from './added-field-value-cell'

/** List columns for the added fields marked "show as a column". */
export function addedFieldColumns<T extends object>(
  fields: readonly ModelFieldDefinition[] | undefined,
  customFieldsOf: (
    row: T,
  ) => ModelFieldRecordValues['customFields'] | null | undefined,
): RegistryColumn<T>[] {
  return (fields ?? [])
    .filter((field) => field.showInList)
    .map((field) => ({
      id: modelFieldColumnId(field.fieldName),
      header: field.label,
      accessorFn: (row) => addedFieldSortValue(field, customFieldsOf(row)),
      meta: {
        exportValue: (row) =>
          addedFieldDisplay(field, customFieldsOf(row)?.[field.fieldName]),
      },
      cell: ({ row }) =>
        createElement(AddedFieldValueCell, {
          field,
          value: customFieldsOf(row.original)?.[field.fieldName],
        }),
    }))
}

/** Insert added columns before the list's final status/owner/updated column. */
export function withAddedColumns<T extends object>(
  base: RegistryColumn<T>[],
  added: RegistryColumn<T>[],
): RegistryColumn<T>[] {
  if (added.length === 0) return base

  return [...base.slice(0, -1), ...added, ...base.slice(-1)]
}
