import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Muted } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { createDataClient } from '#/lib/data-client'
import {
  createWorkspaceGroup,
  deleteWorkspaceGroup,
  setWorkspaceGroupMember,
  workspaceAccessKeys,
} from '#/lib/workspace-access'
import type { WorkspaceGroup } from '#/lib/workspace-access'
import { t } from '#/copy'

const client = createDataClient()

export function WorkspaceGroups({
  workspaceId,
  groups,
  people,
  onClose,
}: {
  workspaceId: string
  groups: WorkspaceGroup[]
  people: { id: string; name: string }[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState(groups.at(0)?.id ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const group = groups.find((g) => g.id === groupId)
  const mutation = useMutation({
    mutationFn: async (
      action:
        | { kind: 'create' }
        | { kind: 'delete' }
        | { kind: 'member'; userId: string; isMember: boolean },
    ) => {
      switch (action.kind) {
        case 'create':
          return createWorkspaceGroup(client, name)
        case 'delete':
          return deleteWorkspaceGroup(client, groupId)
        case 'member':
          return setWorkspaceGroupMember(client, {
            groupId,
            userId: action.userId,
            isMember: action.isMember,
          })
      }
    },
    onSuccess: (_result, action) => {
      void queryClient.invalidateQueries({
        queryKey: workspaceAccessKeys.all(workspaceId),
      })
      setConfirmDelete(false)
      if (action.kind === 'create') setName('')
      if (action.kind === 'delete') setGroupId('')
      toast(
        action.kind === 'member'
          ? t('settings.workspaceGroups.groupMembershipChanged')
          : action.kind === 'delete'
            ? t('settings.workspaceGroups.groupRemoved')
            : t('settings.workspaceGroups.groupCreated'),
      )
    },
    onError: (error: Error) =>
      toast(t('settings.workspaceGroups.couldChangeGroupToast'), {
        description: error.message,
      }),
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('settings.workspaceGroups.workspaceGroups')}
          description={t(
            'settings.workspaceGroups.groupsGrantNothingDescription',
          )}
        />
        <DialogBody>
          <Field label={t('settings.workspaceGroups.newGroupName')}>
            <Input
              aria-label={t('settings.workspaceGroups.newGroupName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </Field>
          <Button
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate({ kind: 'create' })}
          >
            {t('settings.workspaceGroups.createGroup')}
          </Button>
          <Field label={t('settings.workspaceGroups.group')}>
            <Select
              aria-label={t('settings.workspaceGroups.groupManageAria')}
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value)
                setConfirmDelete(false)
              }}
            >
              <option value="">
                {t('settings.workspaceGroups.chooseGroup')}
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          {group ? (
            <>
              <fieldset className="flex max-h-64 flex-col gap-2 overflow-auto">
                <legend className="mb-2 text-label font-medium">
                  {t('settings.workspaceGroups.explicitMembers')}
                </legend>
                {people.map((p) => (
                  <label
                    className="flex items-center gap-2 text-body"
                    key={p.id}
                  >
                    <input
                      type="checkbox"
                      checked={group.member_ids.includes(p.id)}
                      disabled={mutation.isPending}
                      onChange={(e) =>
                        mutation.mutate({
                          kind: 'member',
                          userId: p.id,
                          isMember: e.target.checked,
                        })
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </fieldset>
              {confirmDelete ? (
                <div role="alert" className="flex flex-col gap-2">
                  <Muted>
                    {t('settings.workspaceGroups.removeEveryProject', {
                      name: group.name,
                    })}
                  </Muted>
                  <div className="flex gap-2">
                    <Button
                      variant="danger-fill"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ kind: 'delete' })}
                    >
                      {t('settings.workspaceGroups.confirmRemoval')}
                    </Button>
                    <Button onClick={() => setConfirmDelete(false)}>
                      {t('settings.workspaceGroups.keepGroup')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  {t('settings.workspaceGroups.removeGroup')}
                </Button>
              )}
            </>
          ) : (
            <Muted>{t('settings.workspaceGroups.selectGroupChange')}</Muted>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.done')}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
