import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { createDataClient } from '#/lib/data-client'
import {
  adminQueryKeys,
  describeAdminError,
  setMemberUsername,
} from '#/lib/workspace-admin'
import { t } from '#/copy'

const dataClient = createDataClient()

/** The short sign-in name an administrator gives a member. People see theirs on
 * Profile but can't change it. */
export function MemberUsernameDialog({
  workspaceId,
  userId,
  name,
  current,
  onClose,
}: {
  workspaceId: string
  userId: string
  name: string
  current: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(current)
  const save = useMutation({
    mutationFn: () =>
      setMemberUsername(dataClient, { workspaceId, userId, username: value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.members(workspaceId),
      })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader
          title={t('settings.memberUsernameDialog.username', { name })}
          description={t(
            'settings.memberUsernameDialog.n340LettersDescription',
          )}
        />
        <DialogBody>
          <label className="flex flex-col gap-1 text-label">
            {t('settings.memberUsernameDialog.username2')}
            <Input
              value={value}
              autoFocus
              className="w-[260px]"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {save.isError ? (
            <Notice tone="bad">{describeAdminError(save.error)}</Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={save.isPending || value.trim() === current}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('common.states.saving')
              : t('settings.memberUsernameDialog.saveUsername')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
