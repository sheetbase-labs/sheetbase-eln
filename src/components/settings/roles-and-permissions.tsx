import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Checkbox } from '#/components/ui/checkbox'
import { Select } from '#/components/ui/select'
import { Tooltip } from '#/components/ui/tooltip'
import { TableBox } from '#/components/ui/table'
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
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Stop at the first refused role write; later roles must not be changed after an earlier permission failure.
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

  const roleColumns: RegistryColumn<
    (typeof ROLE_ROWS)[number] & { id: string }
  >[] = [
    {
      id: 'role',
      header: t('settings.rolesAndPermissions.role'),
      size: 200,
      accessorFn: (r) => r.label,
      cell: ({ row }) => (
        <span className="font-medium text-fg">{row.original.label}</span>
      ),
    },
    {
      id: 'what',
      header: t('settings.rolesAndPermissions.whatThey'),
      accessorFn: (r) => ROLE_PLAIN_DESCRIPTIONS[r.key],
      cell: ({ row }) => {
        const text = ROLE_PLAIN_DESCRIPTIONS[row.original.key]

        return (
          <span
            className="block max-w-[44rem] truncate text-fg-muted"
            title={text}
          >
            {text}
          </span>
        )
      },
    },
  ]

  type AreaLine = { id: string; area: (typeof SETTINGS_AREAS)[number] }

  const areaColumns: RegistryColumn<AreaLine>[] = [
    {
      id: 'section',
      header: t('settings.rolesAndPermissions.section'),
      accessorFn: (r) => SETTINGS_AREA_LABELS[r.area],
    },
    {
      id: 'admin',
      header: t('settings.rolesAndPermissions.workspaceAdmin'),
      enableSorting: false,
      cell: () => (
        <span className="text-fg-muted">{SETTINGS_LEVEL_LABELS.manage}</span>
      ),
    },
    ...COLUMNS.map((c): RegistryColumn<AreaLine> => ({
      id: c.roles[0],
      header: c.label,
      enableSorting: false,
      cell: ({ row }) => {
        const area = row.original.area

        return (
          <Select
            size="sm"
            className="w-24"
            aria-label={`${SETTINGS_AREA_LABELS[area]}, ${c.label}`}
            value={settingsLevelFor(area, c.roles[0], rows)}
            disabled={!canEdit || save.isPending}
            onChange={(e) => {
              const level = (['none', 'view', 'manage'] as const).find(
                (option) => option === e.target.value,
              )

              if (!level) return
              save.mutate({ area, roles: c.roles, level })
            }}
          >
            {(['none', 'view', 'manage'] as const).map((level) => (
              <option key={level} value={level}>
                {SETTINGS_LEVEL_LABELS[level]}
              </option>
            ))}
          </Select>
        )
      },
    })),
  ]

  type WorkLine = { id: string; permission: WorkPermission }

  const workColumns: RegistryColumn<WorkLine>[] = [
    {
      id: 'kind',
      header: t('settings.rolesAndPermissions.workKind'),
      accessorFn: (r) => workLabel(r.permission),
      cell: ({ row }) => (
        <Tooltip content={workHint(row.original.permission)}>
          <span className="cursor-default">
            {workLabel(row.original.permission)}
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'admin',
      header: t('settings.rolesAndPermissions.workspaceAdmin'),
      enableSorting: false,
      cell: () => (
        <span className="text-fg-muted">
          {t('settings.rolesAndPermissions.workAlways')}
        </span>
      ),
    },
    ...COLUMNS.map((c): RegistryColumn<WorkLine> => ({
      id: c.roles[0],
      header: c.label,
      enableSorting: false,
      cell: ({ row }) => {
        const permission = row.original.permission
        const label = workLabel(permission)

        return (
          <Checkbox
            aria-label={`${label}, ${c.label}`}
            checked={workPermissionAllowed(permission, c.roles[0], rows)}
            disabled={!canEdit || save.isPending}
            onCheckedChange={(checked) =>
              save.mutate({
                area: `work_${permission}`,
                roles: c.roles,
                level: checked ? 'manage' : 'none',
              })
            }
          />
        )
      },
    })),
  ]

  return (
    <div className="flex flex-col gap-6 px-4 py-5 md:px-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-section">
          {t('settings.rolesAndPermissions.whatEachRole')}
        </h2>
        <TableBox>
          <RegistryGrid
            label="Roles"
            rows={ROLE_ROWS.map((r) => ({ id: r.key, ...r }))}
            columns={roleColumns}
            getRowId={(r) => r.id}
            selectable={false}
          />
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
          <RegistryGrid
            label={t('settings.rolesAndPermissions.settingsAccessRole')}
            rows={SETTINGS_AREAS.map((area) => ({ id: area, area }))}
            columns={areaColumns}
            getRowId={(r) => r.id}
            selectable={false}
          />
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
          <RegistryGrid
            label={t('settings.rolesAndPermissions.workAccessRole')}
            rows={WORK_PERMISSIONS.map((permission) => ({
              id: permission,
              permission,
            }))}
            columns={workColumns}
            getRowId={(r) => r.id}
            selectable={false}
          />
        </TableBox>
      </section>
    </div>
  )
}
