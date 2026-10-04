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
          ? 'Group membership changed'
          : action.kind === 'delete'
            ? 'Group removed'
            : 'Group created',
      )
    },
    onError: (error: Error) =>
      toast('Could not change group', { description: error.message }),
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Workspace groups"
          description="Groups grant nothing until a project rule names them. Membership changes apply immediately and are audited."
        />
        <DialogBody>
          <Field label="New group name">
            <Input
              aria-label="New group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </Field>
          <Button
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate({ kind: 'create' })}
          >
            Create group
          </Button>
          <Field label="Group">
            <select
              aria-label="Group to manage"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value)
                setConfirmDelete(false)
              }}
            >
              <option value="">Choose a group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          {group ? (
            <>
              <fieldset className="flex max-h-64 flex-col gap-2 overflow-auto">
                <legend className="mb-2 text-label font-medium">
                  Explicit members
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
                    Remove {group.name}? Every project grant naming this group
                    will be revoked immediately. This cannot be undone.
                  </Muted>
                  <div className="flex gap-2">
                    <Button
                      variant="danger-fill"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ kind: 'delete' })}
                    >
                      Confirm removal
                    </Button>
                    <Button onClick={() => setConfirmDelete(false)}>
                      Keep group
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  Remove group
                </Button>
              )}
            </>
          ) : (
            <Muted>Select a group to change explicit membership.</Muted>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
