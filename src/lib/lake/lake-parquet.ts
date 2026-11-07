/**
 * Writes the Parquet files of the open tables. Unlike the one-off Parquet
 * export (src/lib/export/parquet.ts, which keeps dates as text) the lake keeps
 * real column types, so DuckDB, Polars and Spark see numbers, dates and
 * timestamps, and returns what the table catalogue needs to know about each
 * file: its footer size and the smallest and largest value in each column.
 */
import type * as arrowTypes from 'apache-arrow'

/** The column types the lake uses; each is a DuckLake type name. */
export type LakeType =
  | 'int64'
  | 'float64'
  | 'varchar'
  | 'boolean'
  | 'date'
  | 'timestamptz'

export interface LakeColumn {
  name: string
  type: LakeType
}

export interface LakeColumnStats {
  /** Cells with a value. */
  valueCount: number
  nullCount: number
  /** Text form DuckLake keeps; null when it is not worth bounding. */
  min: string | null
  max: string | null
  containsNaN: boolean | null
}

export interface LakeParquetFile {
  bytes: Uint8Array
  recordCount: number
  /** Length of the Parquet footer metadata, which DuckLake records. */
  footerSize: number
  stats: LakeColumnStats[]
}

/** Rows written to one Parquet file. Larger tables are split across files. */
export const LAKE_FILE_ROWS = 250_000

interface ParquetModule {
  Table: { fromIPCStream: (ipc: Uint8Array) => unknown }
  WriterPropertiesBuilder: new () => {
    setCompression: (codec: unknown) => { build: () => unknown }
  }
  Compression: Record<'SNAPPY' | 'UNCOMPRESSED', unknown>
  writeParquet: (table: unknown, properties: unknown) => Uint8Array
}

type Arrow = typeof arrowTypes

function toBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'bigint') return value
  const n = Number(value)
  return Number.isFinite(n) ? BigInt(Math.trunc(n)) : null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isNaN(n) ? null : n
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Microseconds since the epoch, to the precision the text carries. */
function toMicros(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null
  const text = value instanceof Date ? value.toISOString() : String(value)
  const ms = Date.parse(text)
  if (Number.isNaN(ms)) return null
  const fraction = /\.(\d{1,6})(?!\d)/.exec(text)?.[1]
  const micros = fraction ? Number(fraction.padEnd(6, '0').slice(3)) : 0
  return BigInt(ms) * 1000n + BigInt(micros)
}

/** DuckLake's text form for a timestamp bound: 2026-11-06 23:54:33.539743+00 */
function micros(value: bigint): string {
  const ms = Number(value / 1000n)
  const rest = Number(((value % 1000n) + 1000n) % 1000n)
  const iso = new Date(ms).toISOString()
  const base = iso.slice(0, 10) + ' ' + iso.slice(11, 19)
  const fraction = iso.slice(20, 23) + String(rest).padStart(3, '0')
  return `${base}.${fraction}+00`
}

function vectorFor(arrow: Arrow, column: LakeColumn, raw: unknown[]) {
  switch (column.type) {
    case 'int64':
      return arrow.vectorFromArray(raw.map(toBigInt), new arrow.Int64())
    case 'float64':
      return arrow.vectorFromArray(raw.map(toNumber), new arrow.Float64())
    case 'boolean':
      return arrow.vectorFromArray(
        raw.map((v) => (v === null || v === undefined ? null : v === true)),
        new arrow.Bool(),
      )
    case 'date':
      return arrow.vectorFromArray(raw.map(toDate), new arrow.DateDay())
    case 'timestamptz': {
      // Arrow's builder takes milliseconds; the data is built directly so the
      // microseconds survive.
      const values = new BigInt64Array(raw.length)
      const valid = new Uint8Array(Math.ceil(raw.length / 8))
      let nulls = 0
      raw.forEach((v, i) => {
        const t = toMicros(v)
        if (t === null) nulls++
        else {
          values[i] = t
          valid[i >> 3] |= 1 << (i & 7)
        }
      })
      return arrow.makeVector(
        arrow.makeData({
          type: new arrow.TimestampMicrosecond('UTC'),
          length: raw.length,
          nullCount: nulls,
          data: values,
          nullBitmap: nulls ? valid : undefined,
        }),
      )
    }
    default:
      return arrow.vectorFromArray(
        raw.map((v) => (v === null || v === undefined ? null : String(v))),
        new arrow.Utf8(),
      )
  }
}

function statsFor(column: LakeColumn, raw: unknown[]): LakeColumnStats {
  let valueCount = 0
  let min: number | bigint | null = null
  let max: number | bigint | null = null
  let containsNaN = false
  for (const v of raw) {
    let x: number | bigint | null = null
    switch (column.type) {
      case 'int64':
        x = toBigInt(v)
        break
      case 'float64':
        x = toNumber(v)
        break
      case 'boolean':
        x = v === null || v === undefined ? null : v === true ? 1 : 0
        break
      case 'date': {
        const d = toDate(v)
        x = d === null ? null : Math.floor(d.getTime() / 86_400_000)
        break
      }
      case 'timestamptz':
        x = toMicros(v)
        break
      default:
        x = v === null || v === undefined ? null : 0
    }
    if (x === null) continue
    valueCount++
    if (typeof x === 'number' && Number.isNaN(x)) {
      containsNaN = true
      continue
    }
    if (min === null || x < min) min = x
    if (max === null || x > max) max = x
  }
  const nullCount = raw.length - valueCount
  const text = (x: number | bigint | null): string | null => {
    if (x === null || column.type === 'varchar') return null
    switch (column.type) {
      case 'date':
        return new Date(Number(x) * 86_400_000).toISOString().slice(0, 10)
      case 'timestamptz':
        return micros(x as bigint)
      case 'float64':
        return String(x)
      default:
        return String(x)
    }
  }
  return {
    valueCount,
    nullCount,
    min: text(min),
    max: text(max),
    containsNaN: column.type === 'float64' ? containsNaN : null,
  }
}

/** One Parquet file holding `rows` (each row a list aligned with `columns`). */
export async function writeLakeParquet(
  columns: LakeColumn[],
  rows: unknown[][],
): Promise<LakeParquetFile> {
  const arrow = (await import('apache-arrow')) as unknown as Arrow
  const parquet =
    (await import('parquet-wasm/node')) as unknown as ParquetModule
  const cells = columns.map((_, i) => rows.map((row) => row[i] ?? null))
  const vectors: Record<string, unknown> = {}
  columns.forEach((column, i) => {
    vectors[column.name] = vectorFor(arrow, column, cells[i])
  })
  const table = (
    arrow.tableFromArrays as unknown as (c: Record<string, unknown>) => arrowTypes.Table
  )(vectors)
  const wasmTable = parquet.Table.fromIPCStream(
    arrow.tableToIPC(table, 'stream'),
  )
  const props = new parquet.WriterPropertiesBuilder()
    .setCompression(parquet.Compression.SNAPPY)
    .build()
  const bytes = parquet.writeParquet(wasmTable, props)
  const tail = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8)
  return {
    bytes,
    recordCount: rows.length,
    footerSize: tail.getUint32(0, true),
    stats: columns.map((column, i) => statsFor(column, cells[i])),
  }
}
