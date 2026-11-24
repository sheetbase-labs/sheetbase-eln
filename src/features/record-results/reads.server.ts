import { z } from 'zod'

import { RECORD_RESULTS_READ_TOOL } from './operations'
import { invalid, toolDef } from '#/lib/assistant-lab-tools.server'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import type { ProviderToolDef } from '#/lib/ai-providers/types'
import { recordResultsSummary } from '#/lib/record-results'
import type { RecordResults } from '#/lib/record-results'
import { recordPath } from '#/lib/navigation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const recordResultsReadSchema = z.strictObject({
  record: z
    .string()
    .min(1)
    .max(80)
    .describe('The record: its identifier, such as SMP-2231, or its id.'),
  includeSnapshots: z
    .boolean()
    .optional()
    .describe('Also include the rows kept in dataset snapshots.'),
  limit: z.number().int().min(1).max(100).optional(),
})

export function recordResultsReadDefs(): ProviderToolDef[] {
  return [
    toolDef(
      RECORD_RESULTS_READ_TOOL,
      'Read every result on a record (a sample, material, experiment or other record): the dataset rows linked to it, grouped by measurement table, with dataset, live or snapshot and values.',
      recordResultsReadSchema,
    ),
  ]
}

export const isRecordResultsReadTool = (name: string): boolean =>
  name === RECORD_RESULTS_READ_TOOL

export async function runRecordResultsReadTool(
  _name: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Raw tool input is immediately checked by recordResultsReadSchema before use.
  args: unknown,
  context: LabToolContext,
): Promise<{ text: string; isError: boolean }> {
  const parsed = recordResultsReadSchema.safeParse(args)

  if (!parsed.success) return { text: invalid(parsed.error), isError: true }

  const { client } = context
  const ref = parsed.data.record.trim()

  try {
    const found = await client.list<{
      id: string
      identifier: string
      title: string
    }>(
      'records',
      `?${UUID.test(ref) ? 'id' : 'identifier'}=eq.${encodeURIComponent(ref)}&select=id,identifier,title&limit=1`,
    )

    if (found.length === 0)
      return { text: `No record found for ${ref}.`, isError: true }

    const [record] = found

    const results = await client.rpc<RecordResults>('record_results', {
      p_record_id: record.id,
      p_include_snapshots: parsed.data.includeSnapshots ?? false,
      p_limit: parsed.data.limit ?? 50,
      p_offset: 0,
    })

    return {
      text: JSON.stringify({
        record: record.identifier,
        title: record.title,
        ...recordResultsSummary(results),
        page: recordPath(record.id),
      }),
      isError: false,
    }
  } catch {
    return { text: 'Those results could not be read just now.', isError: true }
  }
}
