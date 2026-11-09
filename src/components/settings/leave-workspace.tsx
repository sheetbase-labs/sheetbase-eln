import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Section } from '#/components/ui/layout'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { createDataClient, DataClientError } from '#/lib/data-client'
import { t } from '#/copy'

const client = createDataClient()

function leaveMessage(error: unknown): string {
  if (error instanceof DataClientError) {
    if (error.code === 'SB051') return t('account.leave.lastOwner')

    if (error.code === 'SB400') return t('account.leave.onlyWorkspace')
  }

  return t('account.leave.couldNotLeave')
}

/**
 * Leave the workspace you're in (Profile). Owners can leave once someone else
 * owns it, and you can't leave the only workspace you belong to.
 */
export function LeaveWorkspace({
  workspaceId,
  workspaceName,
  otherWorkspaces,
}: {
  workspaceId: string
  workspaceName: string
  /** How many other workspaces the person belongs to. */
  otherWorkspaces: number
}) {
  const [confirming, setConfirming] = useState(false)

  const leave = useMutation({
    mutationFn: () =>
      client.rpc('leave_workspace', { p_workspace_id: workspaceId }),
    onSuccess: () => {
      // A full load re-resolves the person's workspaces and lands on another.
      window.location.assign('/')
    },
  })

  const blocked = otherWorkspaces === 0

  return (
    <Section title={t('account.leave.title')}>
      <p className="m-0 max-w-2xl text-body text-fg-muted">
        {t('account.leave.description', { workspace: workspaceName })}
      </p>
      {blocked ? (
        <Notice tone="info">{t('account.leave.onlyWorkspace')}</Notice>
      ) : null}
      <div>
        <Button
          variant="danger"
          disabled={blocked}
          onClick={() => {
            leave.reset()
            setConfirming(true)
          }}
        >
          {t('account.leave.button')}
        </Button>
      </div>
      {confirming ? (
        <Dialog
          open
          onOpenChange={(open) => (open ? null : setConfirming(false))}
        >
          <DialogContent>
            <DialogHeader
              title={t('account.leave.confirmTitle', {
                workspace: workspaceName,
              })}
              description={t('account.leave.confirmBody')}
            />
            <DialogBody>
              {leave.isError ? (
                <Notice tone="bad">{leaveMessage(leave.error)}</Notice>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button />}>
                {t('common.actions.cancel')}
              </DialogClose>
              <Button
                variant="danger-fill"
                disabled={leave.isPending}
                onClick={() => leave.mutate()}
              >
                {leave.isPending
                  ? t('account.leave.leaving')
                  : t('account.leave.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Section>
  )
}
