import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { createDataClient } from '#/lib/data-client'
import {
  GROUP_ROLES,
  adoptGroupRoles,
  fetchGroupMappings,
  groupRoleKeys,
  removeGroupMapping,
  setGroupMapping,
} from '#/lib/group-roles'
import type { GroupMapping, GroupRole } from '#/lib/group-roles'
import {
  WORKSPACE_ROLE_LABELS,
  adminQueryKeys,
  describeAdminError,
} from '#/lib/workspace-admin'
import { t } from '#/copy'

const client = createDataClient()

/**
 * Members and roles → "Sign-in groups". When people sign in through the lab's
 * identity provider, the groups they belong to there decide their role here.
 * The highest role among a person's groups wins; anyone in none of the listed
 * groups becomes a viewer.
 */
export function SignInGroupsSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [group, setGroup] = useState('')
  const [role, setRole] = useState<GroupRole>('scientist')
  const [error, setError] = useState<string | null>(null)

  const stored = useQuery({
    queryKey: groupRoleKeys.all(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: () => fetchGroupMappings(client, workspaceId),
  })

  const rows = stored.data ?? []

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: groupRoleKeys.all(workspaceId) })

  const add = useMutation({
    mutationFn: () =>
      setGroupMapping(client, { workspaceId, groupName: group, role }),
    onSuccess: async () => {
      setError(null)
      setGroup('')
      await refresh()
      toast.success(t('people.groups.saved'))
    },
    onError: (failure) => setError(describeAdminError(failure)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => removeGroupMapping(client, id),
    onSuccess: refresh,
    onError: (failure) =>
      toast.error(t('people.groups.couldNotSave'), {
        description: describeAdminError(failure),
      }),
  })

  const adopt = useMutation({
    mutationFn: () => adoptGroupRoles(client, workspaceId),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({
        queryKey: adminQueryKeys.members(workspaceId),
      })
      toast.success(t('people.groups.adopted', { count }))
    },
    onError: (failure) =>
      toast.error(t('people.groups.couldNotSave'), {
        description: describeAdminError(failure),
      }),
  })

  if (!canManage && rows.length === 0) return null

  const columns: RegistryColumn<GroupMapping>[] = [
    {
      id: 'group',
      header: t('people.groups.groupColumn'),
      cell: ({ row }) => <span className="mono">{row.original.groupName}</span>,
    },
    {
      id: 'role',
      header: t('people.groups.roleColumn'),
      cell: ({ row }) => WORKSPACE_ROLE_LABELS[row.original.role],
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) =>
        canManage ? (
          <Button
            size="sm"
            variant="quiet"
            disabled={remove.isPending}
            onClick={() => remove.mutate(row.original.id)}
          >
            {t('people.groups.remove')}
          </Button>
        ) : null,
    },
  ]

  return (
    <Section
      title={t('people.groups.title')}
      action={
        canManage && rows.length > 0 ? (
          <Button disabled={adopt.isPending} onClick={() => adopt.mutate()}>
            {t('people.groups.adopt')}
          </Button>
        ) : undefined
      }
    >
      <Muted>{t('people.groups.description')}</Muted>
      {rows.length === 0 ? (
        <Muted>{t('people.groups.none')}</Muted>
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('people.groups.title')}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            selectable={false}
            sortable={false}
          />
        </TableBox>
      )}
      {canManage ? (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()

              if (group.trim()) add.mutate()
            }}
          >
            <Field
              label={t('people.groups.groupLabel')}
              className="min-w-[200px] max-w-[320px] flex-1"
              error={error}
            >
              <Input
                value={group}
                placeholder={t('people.groups.groupPlaceholder')}
                autoComplete="off"
                onChange={(event) => {
                  setGroup(event.target.value)
                  setError(null)
                }}
              />
            </Field>
            <Field label={t('people.groups.givesRole')}>
              <Select
                value={role}
                onChange={(event) => {
                  const selectedRole = GROUP_ROLES.find((option) => option === event.target.value)

                  if (selectedRole) setRole(selectedRole)
                }}
              >
                {GROUP_ROLES.map((item) => (
                  <option key={item} value={item}>
                    {WORKSPACE_ROLE_LABELS[item]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={add.isPending || !group.trim()}>
              {t('people.groups.add')}
            </Button>
          </form>
          <Muted>{t('people.groups.hint')}</Muted>
        </>
      ) : null}
    </Section>
  )
}
