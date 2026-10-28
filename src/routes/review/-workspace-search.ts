import { z } from 'zod'

export const workspaceSearchSchema = z.object({
  tab: z.enum(['diff', 'comments', 'checks', 'history']).optional(),
  comparisonRevisionId: z.string().optional(),
  commentId: z.uuid().optional().catch(undefined),
  signatureMeaning: z
    .enum(['reviewed', 'reviewed-and-approved', 'witnessed'])
    .optional(),
})

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>
