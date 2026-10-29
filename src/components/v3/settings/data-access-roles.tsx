import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { Checkbox } from '#/components/v3/ui/checkbox'
import { Muted, Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import {
  DATA_ACCESS_ROLE_OPTIONS,
  DEFAULT_DATA_ACCESS_ROLES,
  dataAccessKeys,
  fetchDataAccessRoles,
  updateDataAccessRoles,
} from '#/lib/data-access'
import { t } from '#/copy'

/**
 * Settings → Access: which roles see technical details (keys, API routes,
 * database names) and can create a personal read-only SQL login. Owners and
 * administrators change it; the database enforces that.
 */
export function DataAccessRoles({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [draft, setDraft] = useState<string[] | null>(null)
  const query = useQuery({
    queryKey: dataAccessKeys.roles(workspaceId),
    queryFn: () => fetchDataAccessRoles(),
    enabled: Boolean(workspaceId),
  })
  const saved = query.data ?? [...DEFAULT_DATA_ACCESS_ROLES]
  const roles = draft ?? saved
  const save = useMutation({
    mutationFn: (next: string[]) => updateDataAccessRoles(workspaceId, next),
    onSuccess: async (_result, next) => {
      setDraft(null)
      await queryClient.invalidateQueries({
        queryKey: dataAccessKeys.roles(workspaceId),
      })
      await router.invalidate()
      toast(t('settings.dataAccessRoles.dataAccessSavedToast'), {
        description:
          next.length === 0
            ? t('settings.dataAccessRoles.roleDataAccess')
            : t('settings.dataAccessRoles.sqlLoginsMembers'),
      })
    },
    onError: (error: Error) =>
      toast(t('settings.dataAccessRoles.couldSaveDataToast'), {
        description: error.message,
      }),
  })

  function toggle(role: string, on: boolean) {
    const next = on ? [...roles, role] : roles.filter((r) => r !== role)
    setDraft(next)
    save.mutate(next)
  }

  return (
    <Section title={t('settings.dataAccessRoles.dataAccess')}>
      <Muted>{t('settings.dataAccessRoles.membersRolesSee')}</Muted>
      <fieldset
        className="m-0 grid gap-x-6 gap-y-2 border-0 p-0 sm:grid-cols-2 lg:grid-cols-4"
        disabled={!canManage || query.isPending || save.isPending}
      >
        <legend className="sr-only">
          {t('settings.dataAccessRoles.rolesDataAccess')}
        </legend>
        {DATA_ACCESS_ROLE_OPTIONS.map(({ role, label }) => (
          <label key={role} className="flex items-center gap-2 text-body">
            <Checkbox
              checked={roles.includes(role)}
              onCheckedChange={(checked) => toggle(role, checked === true)}
              disabled={!canManage || query.isPending || save.isPending}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {query.isError ? (
        <p role="alert" className="text-label">
          {t('settings.dataAccessRoles.currentSettingCould')}
        </p>
      ) : !canManage ? (
        <Muted>{t('settings.dataAccessRoles.onlyOwnerAdministrator')}</Muted>
      ) : null}
    </Section>
  )
}
