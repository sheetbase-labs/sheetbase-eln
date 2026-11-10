import { z } from 'zod'
import type { DataClient } from '#/lib/data-client'
import type { CanonicalDatasetSchemaField } from '#/lib/dataset-schema-definition-rpc'
import { t } from '#/copy'

export interface MeasurementTable {
  id: string
  name: string
  parentId: string | null
}

export const measurementTableKeys = {
  all: ['ui-port', 'measurement-tables'] as const,
  inherited: (id: string) =>
    ['ui-port', 'measurement-tables', 'inherited', id] as const,
}

export async function fetchMeasurementTables(
  client: DataClient,
): Promise<MeasurementTable[]> {
  const rows = await client.list<{
    id: string
    name: string
    parent_id: string | null
  }>('dataset_schema_definitions', '?select=id,name,parent_id&order=name.asc')

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
  }))
}

/** The tables above `id`, nearest first. */
export function tableAncestors(
  tables: readonly MeasurementTable[],
  id: string,
): MeasurementTable[] {
  const byId = new Map(tables.map((table) => [table.id, table]))
  const out: MeasurementTable[] = []
  const seen = new Set([id])
  let parent = byId.get(id)?.parentId ?? null

  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const table = byId.get(parent)

    if (!table) break
    out.push(table)
    parent = table.parentId
  }

  return out
}

export function tableParentChoices(
  tables: readonly MeasurementTable[],
  id: string,
): MeasurementTable[] {
  return tables.filter(
    (table) =>
      table.id !== id &&
      !tableAncestors(tables, table.id).some((above) => above.id === id),
  )
}

export interface InheritedColumn {
  key: string
  label: string
  type: string
  unit: string | null
  nullable: boolean
}

export interface InheritedColumns {
  tableId: string
  tableName: string
  columns: InheritedColumn[]
}

const COLUMN_TYPES = {
  text: t('library.models.datasetSubtypeUi.text'),
  integer: t('library.models.datasetSubtypeUi.numberWhole'),
  decimal: t('library.models.datasetSubtypeUi.number'),
  boolean: t('library.models.datasetSubtypeUi.yesNo'),
  date: t('library.models.datasetSubtypeUi.date'),
  timestamp: t('library.models.datasetSubtypeUi.dateAndTime'),
  category: t('library.models.datasetSubtypeUi.choice'),
  reference: t('library.models.datasetSubtypeUi.reference'),
}

// Display-only projection. Never rewrite or guess scientific quantity metadata.
const inheritedColumnQuantitySchema = z
  .object({
    symbol: z.string().optional().catch(undefined),
    unit: z.string().optional().catch(undefined),
  })
  .nullable()
  .catch(null)

const inheritedColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  logical_type: z.string(),
  nullable: z.boolean(),
  quantity: inheritedColumnQuantitySchema,
})

export function columnTypeLabel(
  logicalType: string,
  quantity:
    | CanonicalDatasetSchemaField['quantity']
    | z.infer<typeof inheritedColumnQuantitySchema>,
): string {
  const display = inheritedColumnQuantitySchema.parse(quantity)
  const unit = display?.symbol || display?.unit

  const type =
    Object.entries(COLUMN_TYPES).find(([key]) => key === logicalType)?.[1] ??
    logicalType

  return unit ? `${type} · ${unit}` : type
}

/** Each ancestor's published columns, from the top of the chain down. */
export async function fetchInheritedColumns(
  client: DataClient,
  tables: readonly MeasurementTable[],
  id: string,
): Promise<InheritedColumns[]> {
  const chain = tableAncestors(tables, id).reverse()

  return Promise.all(
    chain.map(async (table) => {
      const published = (
        await client.list<{ id: string }>(
          'dataset_schema_versions',
          `?schema_id=eq.${table.id}&lifecycle=eq.active&order=version.desc&limit=1&select=id`,
        )
      ).at(0)

      const fields = published
        ? z
            .array(inheritedColumnSchema)
            .parse(
              await client.list<unknown>(
                'dataset_schema_version_fields',
                `?schema_version_id=eq.${published.id}&lifecycle=eq.active&order=display_order.asc&select=key,label,logical_type,nullable,quantity`,
              ),
            )
        : []

      return {
        tableId: table.id,
        tableName: table.name,
        columns: fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: columnTypeLabel(field.logical_type, field.quantity),
          unit: null,
          nullable: field.nullable,
        })),
      }
    }),
  )
}
