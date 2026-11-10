/**
 * DATA-02 Parquet serializer. Kept in its own module so the WASM engine and
 * Arrow column mapping stay isolated from the streaming serializers; the
 * dynamic imports are the documented runtime-selection exception (only this
 * format needs the engine).
 */
import type * as arrowTypes from 'apache-arrow'

import type { ExportField, ExportRow } from './serializers'

export const PARQUET_MAX_ROWS = 200_000

export async function parquetDocument(
  fields: ExportField[],
  rows: Iterable<ExportRow>,
): Promise<Uint8Array> {
  const materialised = [...rows]

  if (materialised.length > PARQUET_MAX_ROWS) {
    throw new Error(
      `parquet export supports up to ${PARQUET_MAX_ROWS} rows; use csv or ndjson for larger datasets`,
    )
  }

  const [arrow, parquet] = await Promise.all([
    import('apache-arrow'),
    import('parquet-wasm/node'),
  ])

  const columns: Record<string, arrowTypes.Vector> = {}

  for (const field of fields) {
    columns[field.key] = columnVector(
      arrow,
      field.logicalType,
      materialised.map((row) => row.values[field.id] ?? null),
    )
  }

  const table = new arrow.Table(columns)

  const wasmTable = parquet.Table.fromIPCStream(
    arrow.tableToIPC(table, 'stream'),
  )

  const props = new parquet.WriterPropertiesBuilder()
    .setCompression(parquet.Compression.UNCOMPRESSED)
    .build()

  return parquet.writeParquet(wasmTable, props)
}

function columnVector(
  arrow: typeof arrowTypes,
  logicalType: string,
  raw: unknown[],
): arrowTypes.Vector {
  switch (logicalType) {
    case 'integer': {
      const ints = raw.map((v) =>
        v === null ? null : BigInt(Math.trunc(Number(v))),
      )

      return arrow.vectorFromArray(ints, new arrow.Int64())
    }

    case 'decimal': {
      const nums = raw.map((v) => (v === null ? null : Number(v)))

      return arrow.vectorFromArray(nums, new arrow.Float64())
    }

    case 'boolean':
      return arrow.vectorFromArray(
        raw.map((v) => (v === null ? null : v === true)),
        new arrow.Bool(),
      )
    default:
      return arrow.vectorFromArray(
        // Preserve the serializer's JavaScript coercion for non-null values.
        // oxlint-disable-next-line typescript/no-base-to-string
        raw.map((v) => (v === null || v === undefined ? null : String(v))),
        new arrow.Utf8(),
      )
  }
}
