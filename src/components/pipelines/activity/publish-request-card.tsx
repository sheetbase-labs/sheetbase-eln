import { useState } from 'react'

import { t } from '#/copy'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { ReasonDialog } from '#/components/models/model-approval-panel'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import { VersionDiffView } from './version-diff-view'
import type { PublishApproval } from './use-publish-approval'

type Dialog = 'withdraw' | 'approve' | 'return' | null

type Approver = {
  approval: PublishApproval
  actorLabel: (id: string | null | undefined) => string
}

function RequestDialogs({
  approval,
  version,
  dialog,
  setDialog,
}: {
  approval: PublishApproval
  version: PipelineDefinitionVersionWire
  dialog: Dialog
  setDialog: (dialog: Dialog) => void
}) {
  return (
    <>
      <ReasonDialog
        open={dialog === 'withdraw'}
        busy={approval.busy}
        title={t('features.pipelineApprovals.activity.withdrawTitle')}
        description={t('features.pipelineApprovals.activity.withdrawBody', {
          version: version.version,
        })}
        label={t('features.pipelineApprovals.activity.withdrawLabel')}
        required={false}
        confirmLabel={t('features.pipelineApprovals.activity.withdraw')}
        onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
        onConfirm={(reason) =>
          approval.withdraw.mutate(reason, {
            onSuccess: () => setDialog(null),
          })
        }
      />
      <ReasonDialog
        open={dialog === 'approve'}
        busy={approval.busy}
        title={t('features.pipelineApprovals.activity.approveTitle', {
          version: version.version,
        })}
        description={t('features.pipelineApprovals.activity.approveBody', {
          version: version.version,
        })}
        label={t('features.pipelineApprovals.activity.approveLabel')}
        required={false}
        confirmLabel={t('features.pipelineApprovals.activity.approve')}
        onOpenChange={(open) => setDialog(open ? 'approve' : null)}
        onConfirm={(reason) =>
          approval.approve.mutate(reason, {
            onSuccess: () => setDialog(null),
          })
        }
      />
      <ReasonDialog
        open={dialog === 'return'}
        busy={approval.busy}
        title={t('features.pipelineApprovals.activity.returnTitle', {
          version: version.version,
        })}
        description={t('features.pipelineApprovals.activity.returnBody')}
        label={t('features.pipelineApprovals.activity.returnLabel')}
        required
        confirmLabel={t('features.pipelineApprovals.activity.returnConfirm')}
        onOpenChange={(open) => setDialog(open ? 'return' : null)}
        onConfirm={(reason) =>
          approval.returnForChanges.mutate(reason, {
            onSuccess: () => setDialog(null),
          })
        }
      />
    </>
  )
}

function PendingRequest({
  approval,
  actorLabel,
  versions,
  version,
  pending,
}: Approver & {
  versions: readonly PipelineDefinitionVersionWire[]
  version: PipelineDefinitionVersionWire
  pending: NonNullable<PublishApproval['pending']>
}) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const published = versions.find((v) => v.lifecycle === 'published')

  return (
    <section className="flex flex-col gap-3">
      <Notice
        tone="info"
        icon="lock"
        className="bg-review-wash"
        title={t('features.pipelineApprovals.activity.pendingTitle', {
          version: version.version,
        })}
        action={
          <>
            {approval.canWithdraw ? (
              <Button
                size="sm"
                variant="quiet"
                disabled={approval.busy}
                onClick={() => setDialog('withdraw')}
              >
                {t('features.pipelineApprovals.activity.withdraw')}
              </Button>
            ) : null}
            {approval.canDecide ? (
              <>
                <Button
                  size="sm"
                  disabled={approval.busy}
                  onClick={() => setDialog('return')}
                >
                  {t('features.pipelineApprovals.activity.return')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={approval.busy}
                  onClick={() => setDialog('approve')}
                >
                  {t('features.pipelineApprovals.activity.approve')}
                </Button>
              </>
            ) : null}
          </>
        }
      >
        {t('features.pipelineApprovals.activity.pendingBody', {
          name: actorLabel(pending.submitted_by_user_id),
          when: formatNotebookDateTime(pending.submitted_at),
          current: published
            ? t('features.pipelineApprovals.activity.pendingCurrent', {
                version: published.version,
              })
            : t('features.pipelineApprovals.activity.pendingNone'),
        })}{' '}
        {pending.reason ? <span>“{pending.reason}”</span> : null}
        {!approval.canDecide && !approval.canWithdraw ? (
          <span className="text-fg-muted">
            {' '}
            {t('features.pipelineApprovals.activity.onlyAdmin')}
          </span>
        ) : null}
      </Notice>
      <VersionDiffView draft={version} published={published} />
      <RequestDialogs
        approval={approval}
        version={version}
        dialog={dialog}
        setDialog={setDialog}
      />
    </section>
  )
}

function EndedNotice({
  latest,
  draft,
  actorLabel,
}: {
  latest: NonNullable<PublishApproval['latest']>
  draft: PipelineDefinitionVersionWire
  actorLabel: (id: string | null | undefined) => string
}) {
  const returned = latest.state === 'returned'

  return (
    <Notice
      tone={returned ? 'bad' : 'info'}
      icon={returned ? 'warn' : 'info'}
      title={t(
        returned
          ? 'features.pipelineApprovals.activity.returnedTitle'
          : 'features.pipelineApprovals.activity.withdrawnTitle',
        {
          name: actorLabel(latest.decided_by_user_id),
          when: formatNotebookDateTime(latest.decided_at),
        },
      )}
    >
      {latest.decision_reason ? <span>“{latest.decision_reason}” </span> : null}
      <span className="text-fg-muted">
        {t(
          returned
            ? 'features.pipelineApprovals.activity.returnedBody'
            : 'features.pipelineApprovals.activity.withdrawnBody',
          { version: draft.version },
        )}
      </span>
    </Notice>
  )
}

/**
 * The open publish request: who asked and why, the diff an approver reads,
 * and what this person can do about it. When nothing is open it shows how the
 * last request ended (returned or withdrawn) while the draft is still a draft.
 */
export function PublishRequestCard({
  versions,
  approval,
  actorLabel,
}: {
  versions: readonly PipelineDefinitionVersionWire[]
  approval: PublishApproval
  actorLabel: (id: string | null | undefined) => string
}) {
  const { pending, latest } = approval
  const draft = versions.find((v) => v.lifecycle === 'draft')

  if (pending) {
    const version = versions.find((v) => v.id === pending.object_id)

    return version ? (
      <PendingRequest
        approval={approval}
        actorLabel={actorLabel}
        versions={versions}
        version={version}
        pending={pending}
      />
    ) : null
  }

  // Nothing open: say how the last request for the current draft ended.
  if (
    draft &&
    latest &&
    latest.object_id === draft.id &&
    (latest.state === 'returned' || latest.state === 'withdrawn')
  ) {
    return <EndedNotice latest={latest} draft={draft} actorLabel={actorLabel} />
  }

  return null
}
