import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Notice } from '#/components/ui/alert'
import { Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { requestEmailChangeFn } from '#/components/settings/settings-email-data'
import type { EmailChangeRequestResult } from '#/components/settings/settings-email-data'
import { t } from '#/copy'

type Refusal = Extract<
  EmailChangeRequestResult,
  { status: 'refused' }
>['reason']

const REFUSALS: Record<Refusal, () => string> = {
  invalid_address: () => t('account.email.refusedInvalid'),
  same_address: () => t('account.email.refusedSame'),
  address_taken: () => t('account.email.refusedTaken'),
  unknown_user: () => t('account.email.refusedUnknown'),
  no_mail_server: () => t('account.email.refusedNoMail'),
  send_failed: () => t('account.email.couldNotSend'),
}

/**
 * Ask for a new email address. A link goes to the NEW address and the address
 * only changes when it is opened. People change their own; an administrator
 * passes `workspaceId` and `userId` to do it for a member.
 */
export function ChangeEmailDialog({
  current,
  name,
  workspaceId,
  userId,
  onClose,
}: {
  current?: string
  /** Set when an administrator is changing someone else's address. */
  name?: string
  workspaceId?: string
  userId?: string
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const forOther = Boolean(userId)

  const request = useMutation({
    mutationFn: () =>
      requestEmailChangeFn({
        data: { newEmail: value, workspaceId, userId },
      }),
    onSuccess: (result) => {
      if (result.status === 'sent') {
        toast(t('account.email.sentToast', { email: result.email }))
      }
    },
  })

  const result = request.data
  const sent = result && result.status !== 'refused'

  const refusal =
    result?.status === 'refused'
      ? REFUSALS[result.reason]()
      : request.isError
        ? t('account.email.couldNotSend')
        : null

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader
          title={
            forOther
              ? t('account.email.changeFor', { name: name ?? '' })
              : t('account.email.changeTitle')
          }
          description={
            forOther
              ? t('account.email.changeDescriptionAdmin')
              : t('account.email.changeDescription')
          }
        />
        <DialogBody>
          {sent ? (
            <div className="flex flex-col gap-3">
              <Notice tone="info">
                {forOther
                  ? t('account.email.sentNoteAdmin', { email: result.email })
                  : t('account.email.sentNote', { email: result.email })}
              </Notice>
              {result.status === 'link' ? (
                <Notice tone="warn" title={t('account.email.noMailTitle')}>
                  <div className="flex w-full flex-col gap-2">
                    <span>{t('account.email.noMailBody')}</span>
                    <code className="mono break-all text-label">
                      {result.link}
                    </code>
                    <div>
                      <Button
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(result.link)
                            .then(() =>
                              toast(t('account.email.linkCopiedToast')),
                            )
                        }}
                      >
                        {t('account.email.copyLink')}
                      </Button>
                    </div>
                  </div>
                </Notice>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-label">
                {t('account.email.newAddress')}
                <Input
                  type="email"
                  value={value}
                  autoFocus
                  autoComplete="email"
                  placeholder={current}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && value.trim() && !request.isPending)
                      request.mutate()
                  }}
                />
              </label>
              {refusal ? <Notice tone="bad">{refusal}</Notice> : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {sent ? t('common.actions.close') : t('common.actions.cancel')}
          </DialogClose>
          {sent ? null : (
            <Button
              variant="primary"
              disabled={request.isPending || !value.trim()}
              onClick={() => request.mutate()}
            >
              {request.isPending
                ? t('account.email.sending')
                : t('account.email.send')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
