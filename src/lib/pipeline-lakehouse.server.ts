/**
 * SQL against the lakehouse: a pipeline step that reads open tables.
 *
 * The open tables are the workspace's data as Parquet files with a table
 * catalogue (src/lib/lake). A lakehouse step names the tables it reads, and its
 * SQL sees each as a table of that name, as it stands in the table's current
 * snapshot. The files are read here and loaded as temporary tables on the run's
 * connection, then copied into the sandbox like any input, so the step runs
 * under the same limits and the same login as every other SQL step: the
 * sandbox has no way to reach the files, the catalogue or anything else.
 *
 * What it reads is the database's call, not this file's: internal
 * .pipeline_lake_table answers only for a person with data access, and only
 * while the open tables and the steward's switch for pipelines are both on.
 */
import type { QueryResultRow } from 'pg'
import { z } from 'zod'

import { readLakeParquet, LAKE_SQL_TYPES } from './lake/lake-read'
import type { LakeColumn, LakeType } from './lake/lake-parquet'
import { INPUT_FIELD_LIMIT, INPUT_ROW_LIMIT } from './pipeline-limits'
import type { ObjectStorage } from './file-storage/types'

export interface LakeQueryable {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
}

interface LakeTableAnswer {
  tableName: string
  snapshotId: number | string | null
  rowCount: number | string
  columns: LakeColumn[]
  files: Array<{ path: string; rows: number | string }>
}

export interface LoadedLakeTable {
  name: string
  snapshotId: string | null
  rows: number
}

export type LakeLoadOutcome =
  | { kind: 'loaded'; tables: LoadedLakeTable[] }
  | { kind: 'error'; message: string }

// SAFETY: LAKE_SQL_TYPES is keyed by LakeType, so its keys are all LakeTypes.
const TYPES = new Set<LakeType>(Object.keys(LAKE_SQL_TYPES) as LakeType[])

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/** The words for a refusal the database gave. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A caught error is unknown; its code and message are decoded here.
function refusal(error: unknown, table: string): string {
  const coded = z.object({ code: z.string() }).safeParse(error)
  const code = coded.success ? coded.data.code : ''

  const message = error instanceof Error ? error.message : ''

  if (code === '42501')
    return 'SQL against the lakehouse runs as a person with data access, and this run has none.'

  if (/open tables are off/.test(message))
    return 'Open tables are off. A data steward turns them on in Settings.'

  if (/lakehouse SQL is off/.test(message))
    return 'SQL against the lakehouse is off. A data steward turns it on in Settings.'

  if (code === 'P0002')
    return `There is no open table called ${table}, or it has not been written yet.`

  return `The open table ${table} could not be read.`
}

/** Load the named open tables as temporary tables on `conn`. */
export async function loadLakeTables(args: {
  conn: LakeQueryable
  workspaceId: string
  tables: string[]
  storage: Pick<ObjectStorage, 'getStream'>
}): Promise<LakeLoadOutcome> {
  const { conn, workspaceId, tables, storage } = args
  const loaded: LoadedLakeTable[] = []

  for (const name of tables) {
    let answer: LakeTableAnswer

    try {
      const { rows } = await conn.query<{ t: LakeTableAnswer }>(
        `SELECT internal.pipeline_lake_table($1, $2) AS t`,
        [workspaceId, name],
      )

      answer = rows[0].t
    } catch (error) {
      return { kind: 'error', message: refusal(error, name) }
    }

    const columns = answer.columns.filter((column) => TYPES.has(column.type))

    if (Number(answer.rowCount) > INPUT_ROW_LIMIT)
      return {
        kind: 'error',
        message: `The open table ${name} has ${Number(answer.rowCount).toLocaleString('en-GB')} rows; a step reads up to ${INPUT_ROW_LIMIT.toLocaleString('en-GB')}. Filter it into a smaller table first.`,
      }

    if (columns.length === 0 || columns.length > INPUT_FIELD_LIMIT)
      return {
        kind: 'error',
        message: `The open table ${name} has no columns a step can read.`,
      }

    await conn.query(`DROP TABLE IF EXISTS pg_temp.${quote(name)}`)
    await conn.query(
      `CREATE TEMP TABLE ${quote(name)} (${columns
        .map((c) => `${quote(c.name)} ${LAKE_SQL_TYPES[c.type]}`)
        .join(', ')})`,
    )

    let count = 0

    for (const file of answer.files) {
      let bytes: Uint8Array

      try {
        bytes = await readAll(
          (
            await storage.getStream(
              `lake/${workspaceId}/main/${name}/${file.path}`,
            )
          ).stream,
        )
      } catch {
        return {
          kind: 'error',
          message: `A file of the open table ${name} is missing from the file store.`,
        }
      }

      const rows = await readLakeParquet(bytes, columns)

      for (let i = 0; i < rows.length; i += 5000) {
        await conn.query(
          `INSERT INTO pg_temp.${quote(name)}
             SELECT * FROM jsonb_populate_recordset(NULL::pg_temp.${quote(name)}, $1::jsonb)`,
          [JSON.stringify(rows.slice(i, i + 5000))],
        )
      }

      count += rows.length
    }

    loaded.push({
      name,
      snapshotId: answer.snapshotId === null ? null : String(answer.snapshotId),
      rows: count,
    })
  }

  return { kind: 'loaded', tables: loaded }
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break
    chunks.push(value)
  }

  return Buffer.concat(chunks)
}
