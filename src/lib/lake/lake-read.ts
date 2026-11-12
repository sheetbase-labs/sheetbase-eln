/**
 * Reads the Parquet files of the open tables back into rows, for the pipeline
 * step that runs SQL against the lakehouse. The reverse of writeLakeParquet:
 * the columns are the ones the table catalogue names, with the types it gives
 * them, and every value comes back as JSON a database can load (whole numbers
 * as text so none loses digits, dates as `YYYY-MM-DD`, timestamps as ISO 8601).
 */
import { z } from 'zod'
import type * as arrowTypes from 'apache-arrow'

import type { LakeColumn, LakeType } from './lake-parquet'

export type LakeValue = string | number | boolean | null

/** The database type a lake type is loaded as. */
export const LAKE_SQL_TYPES: Record<LakeType, string> = {
  int64: 'bigint',
  float64: 'double precision',
  varchar: 'text',
  boolean: 'boolean',
  date: 'date',
  timestamptz: 'timestamptz',
}

const wholeNumber = z.union([z.bigint(), z.number()])
const finiteNumber = z.number().finite()
const instant = z.union([z.number(), z.date()])

/** A date or timestamp as the number of milliseconds or the date Arrow gives. */
function isoOf(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A value read from Arrow arrives as whatever the vector holds.
  value: unknown,
  length: number | undefined,
): string | null {
  const parsed = instant.safeParse(value)

  if (!parsed.success) return null
  const iso = new Date(parsed.data).toISOString()

  return length ? iso.slice(0, length) : iso
}

function lakeValue(
  type: LakeType,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A value read from Arrow arrives as whatever the vector holds; this is where it is made JSON.
  value: unknown,
): LakeValue {
  if (value === null || value === undefined) return null

  switch (type) {
    case 'int64': {
      const whole = wholeNumber.safeParse(value)

      return whole.success ? String(whole.data) : null
    }

    case 'float64': {
      const number = finiteNumber.safeParse(value)

      return number.success ? number.data : null
    }

    case 'boolean':
      return value === true
    case 'date':
      return isoOf(value, 10)
    case 'timestamptz':
      return isoOf(value, undefined)
    default: {
      const text = z
        .union([z.string(), z.number(), z.bigint()])
        .safeParse(value)

      return text.success ? String(text.data) : null
    }
  }
}

/** The rows of one Parquet file as objects keyed by column name. */
export async function readLakeParquet(
  bytes: Uint8Array,
  columns: LakeColumn[],
): Promise<Array<Record<string, LakeValue>>> {
  const [arrow, parquet] = await Promise.all([
    import('apache-arrow'),
    import('parquet-wasm/node'),
  ])

  const table: arrowTypes.Table = arrow.tableFromIPC(
    parquet.readParquet(bytes).intoIPCStream(),
  )

  const vectors = columns.map((column) => table.getChild(column.name))
  const rows: Array<Record<string, LakeValue>> = []

  for (let i = 0; i < table.numRows; i++) {
    const row: Record<string, LakeValue> = {}

    columns.forEach((column, c) => {
      row[column.name] = lakeValue(column.type, vectors[c]?.get(i))
    })
    rows.push(row)
  }

  return rows
}
