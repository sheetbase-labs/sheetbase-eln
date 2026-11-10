import { z } from 'zod'

/** Stable run, output and proposal identities shared by the editor and reader.
 * Reading preserves additional stored fields; choosing a run builds a new payload. */
export const pipelineOutputPayload = z.looseObject({
  runId: z.string().optional().catch(undefined),
  datasetId: z.string().optional().catch(undefined),
  datasetVersionId: z.string().optional().catch(undefined),
  label: z.string().optional().catch(undefined),
  proposalId: z.string().optional().catch(undefined),
})
