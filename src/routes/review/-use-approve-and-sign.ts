import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { reviewWorkspaceQueryKeys } from '#/lib/review-workspace'
import { signatureMeaningEnabled } from '#/lib/signatures'

type SigningPolicy = Parameters<typeof signatureMeaningEnabled>[0]

/**
 * Approving and signing are one step for a reviewer who may sign: one dialog
 * records the decision and then the signature. Without it (no certified
 * signature, or the policy switches the meaning off) Approve keeps its own
 * confirmation.
 */
export function useApproveAndSign({
  canReview,
  state,
  meanings,
  policy,
  submissionId,
  revisionId,
  digest,
  onSigningOpenChange,
  approve,
}: {
  canReview: boolean
  state: string | undefined
  meanings: readonly string[]
  policy: SigningPolicy
  submissionId: string | undefined
  revisionId: string | undefined
  digest: string | null
  onSigningOpenChange: (open: boolean) => void
  approve: (input: {
    submissionId: string
    expectedRevisionDigest: string
  }) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [active, setActive] = useState(false)

  const may =
    canReview &&
    state === 'submitted' &&
    meanings.length > 0 &&
    signatureMeaningEnabled(policy, 'reviewed-and-approved')

  const onOpenChange = useCallback(
    (next: boolean) => {
      onSigningOpenChange(next)

      if (!next) setActive(false)
    },
    [onSigningOpenChange],
  )

  const start = useCallback(() => {
    setActive(true)
    onSigningOpenChange(true)
  }, [onSigningOpenChange])

  const approveFirst = useMemo(
    () =>
      active && may && submissionId && revisionId
        ? {
            run: async () => {
              await approve({
                submissionId,
                expectedRevisionDigest: digest ?? '',
              })
              await queryClient.invalidateQueries({
                queryKey: reviewWorkspaceQueryKeys.decisions(submissionId),
              })
              await queryClient.invalidateQueries({
                queryKey:
                  reviewWorkspaceQueryKeys.submissionForRevision(revisionId),
              })
            },
            done: () => setActive(false),
          }
        : null,
    [active, may, submissionId, revisionId, digest, approve, queryClient],
  )

  return {
    onApproveAndSign: may ? start : undefined,
    onOpenChange,
    approveFirst,
  }
}
