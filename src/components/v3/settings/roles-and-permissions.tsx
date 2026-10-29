import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Notice } from '#/components/v3/ui/alert'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Select } from '#/components/v3/ui/select'
import { Tooltip } from '#/components/v3/ui/tooltip'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { createDataClient } from '#/lib/data-client'
import {
  MEMBER_CLASS_ROLES,
  ROLE_PLAIN_DESCRIPTIONS,
  SETTINGS_AREAS,
  SETTINGS_AREA_LABELS,
  SETTINGS_LEVEL_LABELS,
  WORK_PERMISSIONS,
  settingsLevelFor,
  workPermissionAllowed,
} from '#/lib/settings-access'
import type {
  WorkPermission,
  SettingsAccessRow,
  SettingsLevel,
} from '#/lib/settings-access'
import { describeAdminError } from '#/lib/workspace-admin'
import { t } from '#/copy'

const dataClient = createDataClient()

const queryKey = (workspaceId: string) =>
  ['settings-access', workspaceId] as const

/** The matrix's columns. Scientist stands for the scientist and member roles,
 * which the workspace treats alike. */
const COLUMNS: Array<{ label: string; roles: string[] }> = [
  { label: t('settings.rolesAndPermissions.admin'), roles: ['admin'] },
  { label: t('settings.rolesAndPermissions.dataSteward'), roles: ['steward'] },
  {
    label: t('settings.rolesAndPermissions.scientist'),
    roles: [...MEMBER_CLASS_ROLES],
  },
  { label: t('settings.rolesAndPermissions.analyst'), roles: ['analyst'] },
  { label: t('settings.rolesAndPermissions.reviewer'), roles: ['reviewer'] },
  { label: t('settings.rolesAndPermissions.viewer'), roles: ['viewer'] },
]

const ROLE_ROWS: Array<{ label: string; key: string }> = [
  { label: t('settings.rolesAndPermissions.workspaceAdmin'), key: 'owner' },
  { label: t('settings.rolesAndPermissions.admin'), key: 'admin' },
  { label: t('settings.rolesAndPermissions.dataSteward'), key: 'steward' },
  { label: t('settings.rolesAndPermissions.scientist'), key: 'scientist' },
  { label: t('settings.rolesAndPermissions.analyst'), key: 'analyst' },
  { label: t('settings.rolesAndPermissions.reviewer'), key: 'reviewer' },
  { label: t('settings.rolesAndPermissions.viewer'), key: 'viewer' },
  {
    label: t('settings.rolesAndPermissions.clientViewer'),
    key: 'client_viewer',
  },
]

const workLabel = (permission: WorkPermission) =>
  t(`settings.rolesAndPermissions.work_${permission}`)
const workHint = (permission: WorkPermission) =>
  t(`settings.rolesAndPermissions.work_${permission}_hint`)

export function RolesAndPermissions({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  /** Only the workspace admin changes which roles reach which section. */
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const stored = useQuery({
    queryKey: queryKey(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: () =>
      dataClient.list<SettingsAccessRow>(
        'settings_access',
        '?select=area,role,level',
      ),
  })
  const rows = stored.data ?? []

  const save = useMutation({
    mutationFn: async (input: {
      area: string
      roles: string[]
      level: SettingsLevel
    }) => {
      for (const role of input.roles) {
        await dataClient.rpc('set_settings_access', {
          p_workspace_id: workspaceId,
          p_area: input.area,
          p_role: role,
          p_level: input.level,
        })
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKey(workspaceId) }),
  })

  return (
    <div className="flex flex-col gap-6 px-4 py-5 md:px-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-section">
          {t('settings.rolesAndPermissions.whatEachRole')}
        </h2>
        <TableBox>
          <Table caption="Roles">
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.rolesAndPermissions.role')}</TableHead>
                <TableHead>
                  {t('settings.rolesAndPermissions.whatThey')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROLE_ROWS.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {r.label}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {ROLE_PLAIN_DESCRIPTIONS[r.key]}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-section">
          {t('settings.rolesAndPermissions.whoOpenEach')}
        </h2>
        <p className="m-0 text-label text-fg-muted">
          {canEdit
            ? t('settings.rolesAndPermissions.chooseWhatEach')
            : t('settings.rolesAndPermissions.onlyWorkspaceAdmin')}
        </p>
        {save.isError ? (
          <Notice tone="bad">{describeAdminError(save.error)}</Notice>
        ) : null}
        <TableBox>
          <Table caption={t('settings.rolesAndPermissions.settingsAccessRole')}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('settings.rolesAndPermissions.section')}
                </TableHead>
                <TableHead>
                  {t('settings.rolesAndPermissions.workspaceAdmin')}
                </TableHead>
                {COLUMNS.map((c) => (
                  <TableHead key={c.label}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {SETTINGS_AREAS.map((area) => (
                <TableRow key={area}>
                  <TableCell className="whitespace-nowrap">
                    {SETTINGS_AREA_LABELS[area]}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {SETTINGS_LEVEL_LABELS.manage}
                  </TableCell>
                  {COLUMNS.map((c) => (
                    <TableCell key={c.label}>
                      <Select
                        size="sm"
                        className="w-28"
                        aria-label={`${SETTINGS_AREA_LABELS[area]}, ${c.label}`}
                        value={settingsLevelFor(area, c.roles[0], rows)}
                        disabled={!canEdit || save.isPending}
                        onChange={(e) =>
                          save.mutate({
                            area,
                            roles: c.roles,
                            level: e.target.value as SettingsLevel,
                          })
                        }
                      >
                        {(['none', 'view', 'manage'] as const).map((level) => (
                          <option key={level} value={level}>
                            {SETTINGS_LEVEL_LABELS[level]}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableBox>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-section">
          {t('settings.rolesAndPermissions.whatPeopleCanDo')}
        </h2>
        <p className="m-0 text-label text-fg-muted">
          {canEdit
            ? t('settings.rolesAndPermissions.workHelp')
            : t('settings.rolesAndPermissions.onlyWorkspaceAdmin')}
        </p>
        <TableBox>
          <Table caption={t('settings.rolesAndPermissions.workAccessRole')}>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('settings.rolesAndPermissions.workKind')}
                </TableHead>
                <TableHead>
                  {t('settings.rolesAndPermissions.workspaceAdmin')}
                </TableHead>
                {COLUMNS.map((c) => (
                  <TableHead key={c.label}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {WORK_PERMISSIONS.map((permission) => {
                const label = workLabel(permission)
                return (
                  <TableRow key={permission}>
                    <TableCell className="whitespace-nowrap">
                      <Tooltip content={workHint(permission)}>
                        <span className="cursor-default">{label}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {t('settings.rolesAndPermissions.workAlways')}
                    </TableCell>
                    {COLUMNS.map((c) => (
                      <TableCell key={c.label}>
                        <Checkbox
                          aria-label={`${label}, ${c.label}`}
                          checked={workPermissionAllowed(
                            permission,
                            c.roles[0],
                            rows,
                          )}
                          disabled={!canEdit || save.isPending}
                          onCheckedChange={(checked) =>
                            save.mutate({
                              area: `work_${permission}`,
                              roles: c.roles,
                              level: checked ? 'manage' : 'none',
                            })
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableBox>
      </section>
    </div>
  )
}
