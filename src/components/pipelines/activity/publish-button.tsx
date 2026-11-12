import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { ReasonDialog } from '#/components/models/model-approval-panel'
import type { PipelineDefinitionVersionWire } from '#/lib/pipelines/types'
import type { PublishApproval } from './use-publish-approval'

/**
 * The one way to publish: "Publish v5…" asks an admin to approve. While the
 * request waits it says so, and an approver is taken to the request on the
 * Activity tab, where the diff is.
 */
export function PublishButton({
  pipelineId,
  version,
  draftId,
  versions,
  approval,
  disabled,
  title,
  variant = 'primary',
}: {
  pipelineId: string
  /** The number the version being published will have. */
  version: number
  /** The saved draft, when there is one; the page saves its edits when there is not. */
  draftId?: string
  versions: readonly PipelineDefinitionVersionWire[]
  approval: PublishApproval
  disabled?: boolean
  title?: string
  variant?: 'primary' | 'secondary'
}) {
  const [open, setOpen] = useState(false)
  const current = versions.find((v) => v.lifecycle === 'published')

  if (draftId !== undefined && approval.pending?.object_id === draftId) {
    return approval.canDecide ? (
      <Button
        variant={variant}
        nativeButton={false}
        render={
          <Link to="/pipelines/$pipelineId/activity" params={{ pipelineId }} />
        }
      >
        {t('features.pipelineApprovals.publish.review')}
      </Button>
    ) : (
      <Button
        disabled
        title={t('features.pipelineApprovals.activity.onlyAdmin')}
      >
        {t('features.pipelineApprovals.publish.waiting')}
      </Button>
    )
  }

  return (
    <>
      <Button
        variant={variant}
        disabled={disabled || approval.busy}
        title={title}
        onClick={() => setOpen(true)}
      >
        {t('features.pipelineApprovals.publish.action', {
          version,
        })}
      </Button>
      <ReasonDialog
        open={open}
        busy={approval.ask.isPending}
        title={t('features.pipelineApprovals.publish.dialogTitle', {
          version,
        })}
        description={
          current
            ? t('features.pipelineApprovals.publish.dialogBody', {
                current: current.version,
              })
            : t('features.pipelineApprovals.publish.dialogBodyFirst')
        }
        label={t('features.pipelineApprovals.publish.reasonLabel')}
        required
        confirmLabel={t('features.pipelineApprovals.publish.confirm')}
        onOpenChange={setOpen}
        onConfirm={(reason) =>
          approval.ask.mutate(
            { versionId: draftId, reason },
            { onSuccess: () => setOpen(false) },
          )
        }
      />
    </>
  )
}
