import { z } from 'zod'

import { PLATE_RUN_BLOCK_VIEWS } from '#/lib/blocks/validators'
import type { NotebookBlock } from '#/lib/notebook-data'

/** What the block holds. `pinned` is the database's copy of the result, never ours. */
const pinnedSchema = z.looseObject({
  reference: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  qcStatus: z.string().optional().catch(undefined),
  zPrime: z.number().optional().catch(undefined),
  signalToBackground: z.number().optional().catch(undefined),
  hitSamples: z.number().optional().catch(undefined),
  testedSamples: z.number().optional().catch(undefined),
  readWells: z.number().optional().catch(undefined),
  analysedAt: z.string().optional().catch(undefined),
})

export const plateRunBlockPayload = z.looseObject({
  runId: z.string().optional().catch(undefined),
  view: z.enum(PLATE_RUN_BLOCK_VIEWS).optional().catch(undefined),
  pinned: pinnedSchema.optional().catch(undefined),
})

export type PlateRunBlockPayload = z.infer<typeof plateRunBlockPayload>

/** Whether a block's payload already names a run. */
export function plateRunBlockHasRun(
  payload: NotebookBlock['payload'],
): boolean {
  return Boolean(plateRunBlockPayload.safeParse(payload).data?.runId)
}
