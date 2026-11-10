/**
 * The protocol versions panel's writes: submit, decide, withdraw and release,
 * each one refreshing the list the panel reads. Apart from the panel so that
 * file holds only the component.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import {
  approveProtocolRevision,
  makeProtocolVersionEffective,
  submitProtocolRevision,
} from '#/lib/protocol-revisions'
import {
  returnApprovalRequest,
  withdrawApprovalRequest,
} from '#/lib/approval-requests'
import type { DataClient } from '#/lib/data-client'
import type { ProtocolVersion } from '#/lib/controlled-protocols'
import { t } from '#/copy'

/** What the panel's writes need from the screen that owns them. */
export interface VersionActionDeps {
  client: DataClient
  protocolRecordId: string
  workspaceId: string | null | undefined
  /** Called after a successful write: the dialog closes and the list refreshes. */
  onCloseDialog: () => void
}

export function useProtocolVersionActions(deps: VersionActionDeps) {
  const { client, protocolRecordId, workspaceId, onCloseDialog } = deps
  const queryClient = useQueryClient()

  function refresh() {
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-versions'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'models', 'approval-index'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-acknowledgements'],
    })
  }

  const failed = (title: string) => (cause: unknown) =>
    toast(title, {
      description:
        cause instanceof Error
          ? cause.message
          : t('library.protocols.protocolVersionsPanel.pleaseTryAgain'),
    })

  const submit = useMutation({
    mutationFn: (input: { summary: string; resume?: ProtocolVersion }) =>
      submitProtocolRevision(client, {
        workspaceId: workspaceId ?? '',
        protocolRecordId,
        changeSummary: input.summary,
        existingVersion: input.resume,
      }),
    onSuccess: () => {
      onCloseDialog()
      refresh()
      toast(t('library.protocols.protocolVersionsPanel.submittedForReview'), {
        description: t(
          'library.protocols.protocolVersionsPanel.aScientistOrStewardReviews',
        ),
      })
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotSubmitTheVersion'),
    ),
  })

  const approve = useMutation({
    mutationFn: (input: {
      version: ProtocolVersion
      requestId: string
      reason: string
    }) =>
      approveProtocolRevision(client, {
        requestId: input.requestId,
        versionId: input.version.id,
        reason: input.reason || undefined,
      }),
    onSuccess: (result, input) => {
      onCloseDialog()
      refresh()

      if (result.effective) {
        toast(
          t('library.protocols.protocolVersionsPanel.vIsNowEffective', {
            version: input.version.version,
          }),
          {
            description: t(
              'library.protocols.protocolVersionsPanel.newExperimentsStartFromIt',
            ),
          },
        )
      } else if (result.releaseError) {
        toast(
          t(
            'library.protocols.protocolVersionsPanel.approvedButNotYetEffective',
          ),
          {
            description: t(
              'library.protocols.protocolVersionsPanel.useMakeEffectiveOnThis',
              { releaseError: result.releaseError },
            ),
          },
        )
      } else {
        toast(t('library.protocols.protocolVersionsPanel.approvalRecorded'), {
          description: t(
            'library.protocols.protocolVersionsPanel.qaApprovesNextTheLast',
          ),
        })
      }
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotApprove'),
    ),
  })

  const returnBack = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      returnApprovalRequest(client, input.requestId, input.reason),
    onSuccess: () => {
      onCloseDialog()
      refresh()
      toast(t('library.protocols.protocolVersionsPanel.returnedToTheAuthor'))
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotReturnTheVersion'),
    ),
  })

  const withdraw = useMutation({
    mutationFn: (input: { requestId: string; reason: string }) =>
      withdrawApprovalRequest(
        client,
        input.requestId,
        input.reason || undefined,
      ),
    onSuccess: () => {
      onCloseDialog()
      refresh()
      toast(t('library.protocols.protocolVersionsPanel.submissionWithdrawn'))
    },
    onError: failed(
      t(
        'library.protocols.protocolVersionsPanel.couldNotWithdrawTheSubmission',
      ),
    ),
  })

  const release = useMutation({
    mutationFn: (version: ProtocolVersion) =>
      makeProtocolVersionEffective(client, version.id),
    onSuccess: (version) => {
      refresh()
      toast(
        t('library.protocols.protocolVersionsPanel.vIsNowEffective', {
          version: version.version,
        }),
      )
    },
    onError: failed(
      t('library.protocols.protocolVersionsPanel.couldNotMakeItEffective'),
    ),
  })

  const busy =
    submit.isPending ||
    approve.isPending ||
    returnBack.isPending ||
    withdraw.isPending ||
    release.isPending

  return { submit, approve, returnBack, withdraw, release, busy }
}
