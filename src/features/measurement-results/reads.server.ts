import { z } from 'zod'

import { queryMeasurementTableRows } from './data'
import type { ResultQuery } from './data'
import { MEASUREMENT_RESULTS_READ_TOOL } from './tool'
import { invalid, likeValue, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { DataClient } from '#/lib/data-client'
import type { ProviderToolDef } from '#/lib/ai-providers/types'

/**
 * `sheetbase.measurement_table.query`: the rows of one kind of result across
 * every dataset the person can open, with the dataset and snapshot of each row,
 * through the same call as the app and as the signed-in person.
 */
export const measurementResultsReadSchema = z.strictObject({
  table: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'The measurement table, by name, key or id such as MDL-0012 (for example "ViCell" or ddpcr_titre).',
    ),
  datasets: z
    .array(z.string().min(1).max(200))
    .max(50)
    .optional()
    .describe(
      'Only these datasets, by name or display id such as DS-0297. All the datasets that hold the table if left out.',
    ),
  snapshots: z
    .enum(['live', 'latest'])
    .optional()
    .describe(
      'live (default): each dataset as it is now. latest: each dataset’s newest snapshot; datasets with none are left out and listed.',
    ),
  record: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Only rows that link to this record, by identifier such as SMP-2231.',
    ),
  where: z
    .array(
      z.strictObject({
        column: z.string().min(1).max(120),
        operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']),
        value: z.union([z.string().max(200), z.number(), z.boolean()]),
      }),
    )
    .max(8)
    .optional()
    .describe('Conditions on columns, all of which must hold.'),
  sortBy: z.string().min(1).max(120).optional(),
  descending: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

type Input = z.infer<typeof measurementResultsReadSchema>

export function measurementResultsReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      MEASUREMENT_RESULTS_READ_TOOL,
      'Read one kind of result (a measurement table such as ViCell viability) across every dataset the person can open, live or at snapshots, with the dataset and snapshot each row came from. Use it for questions like "all ddPCR titres for SMP-2231" or "viability across the harvest datasets". To analyse the same rows, call the analysis run tool with the table instead of a dataset.',
      measurementResultsReadSchema,
    ),
  ]
}

export const isMeasurementResultsReadTool = (name: string): boolean =>
  name === MEASUREMENT_RESULTS_READ_TOOL

interface TableRow {
  id: string
  key: string
  name: string
  display_id: string | null
}

interface DatasetMatch {
  id: string
  name: string
  display_id: string | null
}

/** The one measurement table a person means, or a message saying which. */
export async function findMeasurementTable(
  client: DataClient,
  text: string,
): Promise<TableRow | { message: string }> {
  const like = likeValue(text)

  const rows = await client.list<TableRow>(
    'dataset_schema_definitions',
    `?lifecycle=eq.active&or=(key.ilike.${like},name.ilike.${like},display_id.ilike.${like})&select=id,key,name,display_id&order=name&limit=6`,
  )

  const lower = text.trim().toLowerCase()

  const exact = rows.filter(
    (row) =>
      row.key.toLowerCase() === lower ||
      row.name.toLowerCase() === lower ||
      row.display_id?.toLowerCase() === lower,
  )

  const matches = exact.length === 1 ? exact : rows

  if (matches.length === 1) return matches[0]

  if (matches.length === 0)
    return { message: `No measurement table matches "${text}".` }

  return {
    message: `More than one measurement table matches "${text}": ${matches
      .map((row) => row.name)
      .join(', ')}. Ask which one.`,
  }
}

/** Dataset ids for names or display ids, or a message when one is not found. */
async function findDatasets(
  client: DataClient,
  texts: readonly string[],
): Promise<{ ids: string[] } | { message: string }> {
  const ids: string[] = []

  for (const text of texts) {
    const like = likeValue(text)

    // react-doctor-disable-next-line react-doctor/async-await-in-loop -- A name that matches nothing stops the lookup with its own message.
    const rows = await client.list<DatasetMatch>(
      'datasets',
      `?or=(name.ilike.${like},display_id.ilike.${like})&select=id,name,display_id&limit=6`,
    )

    const lower = text.trim().toLowerCase()

    const exact = rows.filter(
      (row) =>
        row.display_id?.toLowerCase() === lower ||
        row.name.toLowerCase() === lower,
    )

    const matches = exact.length === 1 ? exact : rows

    if (matches.length !== 1)
      return {
        message:
          matches.length === 0
            ? `No dataset matches "${text}".`
            : `More than one dataset matches "${text}": ${matches
                .map((row) => row.display_id ?? row.name)
                .join(', ')}. Ask which one.`,
      }
    ids.push(matches[0].id)
  }

  return { ids }
}

async function findRecordId(
  client: DataClient,
  text: string,
): Promise<{ id: string } | { message: string }> {
  const rows = await client.list<{ id: string; identifier: string }>(
    'records',
    `?deleted_at=is.null&or=(identifier.ilike.${likeValue(text)})&select=id,identifier&limit=4`,
  )

  const exact = rows.filter(
    (row) => row.identifier.toLowerCase() === text.trim().toLowerCase(),
  )

  const matches = exact.length === 1 ? exact : rows

  if (matches.length === 1) return { id: matches[0].id }

  return {
    message:
      matches.length === 0
        ? `No record matches "${text}".`
        : `More than one record matches "${text}": ${matches
            .map((row) => row.identifier)
            .join(', ')}. Ask which one.`,
  }
}

/** The query a tool call asks for, with names turned into ids. */
export async function resultQueryFor(
  client: DataClient,
  input: Pick<
    Input,
    'datasets' | 'snapshots' | 'record' | 'where' | 'sortBy' | 'descending'
  >,
): Promise<{ query: ResultQuery } | { message: string }> {
  const query: ResultQuery = {
    mode: input.snapshots === 'latest' ? 'latest_snapshot' : 'live',
  }

  if (input.datasets?.length) {
    const found = await findDatasets(client, input.datasets)

    if ('message' in found) return found
    query.datasets = found.ids
  }

  if (input.record) {
    const found = await findRecordId(client, input.record)

    if ('message' in found) return found
    query.recordId = found.id
  }

  if (input.where?.length)
    query.filters = input.where.map((item) => ({
      field: item.column,
      operator: item.operator,
      value: item.value,
    }))

  if (input.sortBy)
    query.sort = {
      field: input.sortBy,
      direction: input.descending ? 'desc' : 'asc',
    }

  return { query }
}

export async function runMeasurementResultsReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is immediately checked by measurementResultsReadSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = measurementResultsReadSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  try {
    const table = await findMeasurementTable(context.client, parsed.data.table)

    if ('message' in table) return { text: table.message, isError: true }
    const built = await resultQueryFor(context.client, parsed.data)

    if ('message' in built) return { text: built.message, isError: true }

    const result = await queryMeasurementTableRows(
      context.client,
      table.id,
      built.query,
      parsed.data.limit ?? 25,
      0,
    )

    return {
      text: JSON.stringify({
        table: table.name,
        columns: result.columns.map((column) => ({
          key: column.key,
          label: column.label,
          unit: column.quantity?.storageUnit,
        })),
        read: result.sources.map((source) => ({
          dataset: source.displayId ?? source.name,
          name: source.name,
          at: source.live ? 'live' : `snapshot "${source.snapshotLabel ?? ''}"`,
        })),
        leftOut: result.skipped.map((item) => ({
          dataset: item.displayId ?? item.name,
          why: item.reason === 'no_snapshot' ? 'has no snapshot' : item.reason,
        })),
        totalRows: result.totalCount,
        returned: result.rows.length,
        rows: result.rows.map((row) => ({
          dataset: row.datasetDisplayId ?? row.datasetName,
          at: row.live ? 'live' : (row.snapshotLabel ?? 'snapshot'),
          ...row.values,
        })),
        page: `/models/${table.id}/results`,
      }),
      isError: false,
    }
  } catch (error) {
    return {
      text:
        error instanceof Error && error.message
          ? error.message
          : 'That could not be read just now.',
      isError: true,
    }
  }
}
