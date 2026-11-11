/**
 * One record as a plugin sees it: its name and status, then its fields by
 * name. Kept out of the component module so the table hooks can export only
 * cards and hooks (Fast Refresh reloads a module that exports anything else).
 */
import { recordFieldValue } from '#/components/models/models-data'
import type { RecordModelRecord } from '#/components/models/models-data'
import type { ModelFieldDefinition } from '#/lib/model-fields'

/** The value type a plugin row carries under each field name. */
export type PluginRowValue = Exclude<
  ReturnType<typeof recordFieldValue>,
  undefined
>

/** A record as a plugin receives it over the JSON wire. */
export interface PluginRow {
  id: string
  identifier: string
  title: string
  status: string
  [fieldName: string]: PluginRowValue
}

export function pluginRow(
  record: RecordModelRecord,
  fields: readonly ModelFieldDefinition[],
  inputs?: readonly string[],
): PluginRow {
  const row: PluginRow = {
    id: record.id,
    identifier: record.identifier,
    title: record.title,
    status: record.status,
  }

  const wanted = inputs ? new Set(inputs) : null

  for (const field of fields) {
    if (wanted && !wanted.has(field.fieldName)) continue

    row[field.fieldName] = recordFieldValue(record, field.fieldName) ?? null
  }

  return row
}
