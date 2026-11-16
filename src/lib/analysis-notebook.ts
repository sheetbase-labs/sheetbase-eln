import { z } from 'zod'
import type { DataClient } from './data-client'

const addedSchema = z.object({
  block: z.object({ id: z.string() }),
  already_there: z.boolean(),
})

/**
 * Puts a saved analysis into an experiment's notebook as a live block, through
 * the same database function the API, MCP, the assistant and pipelines call.
 * Asking again for an analysis the notebook already holds returns that block
 * (`alreadyThere`) rather than adding a second.
 */
export async function addAnalysisToNotebook(
  client: Pick<DataClient, 'rpc'>,
  args: { recordId: string; definitionId: string; title?: string },
): Promise<{ blockId: string; alreadyThere: boolean }> {
  const result = addedSchema.parse(
    await client.rpc('add_analysis_to_notebook', {
      p_record_id: args.recordId,
      p_definition_id: args.definitionId,
      p_title: args.title?.trim() || null,
    }),
  )

  return { blockId: result.block.id, alreadyThere: result.already_there }
}

/** The notebook address of one block, which scrolls to it and marks it. */
export function notebookBlockHref(recordId: string, blockId: string): string {
  return `/experiments/${recordId}/notebook#block-${blockId}`
}
