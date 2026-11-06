import { z } from 'zod'

export const workspaceSearchSchema = z.object({
  tab: z.enum(['diff', 'comments', 'checks', 'history']).optional(),
  comparisonRevisionId: z.string().optional(),
  commentId: z.uuid().optional().catch(undefined),
  signatureMeaning: z
    .enum(['reviewed', 'reviewed-and-approved', 'witnessed'])
    .optional(),
  /** Opens the decision dialog on arrival, from the experiment's header. */
  decide: z.enum(['approve', 'request_changes']).optional().catch(undefined),
})

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>
