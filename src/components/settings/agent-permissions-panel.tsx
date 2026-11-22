/**
 * Settings > AI > Agent permissions: for every action an agent can take in the
 * lab, Auto (runs straight away), Ask (waits for a person) or Never. One
 * setting for everyone, with exceptions for a role or a service credential.
 */
import { memo, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type {
  RegistryColumn,
  RegistryRow,
} from '#/components/inventory/registry-grid'
import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { Field, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { toast } from '#/components/ui/sonner'
import { TableBox } from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import {
  AGENT_ACTIONS,
  AGENT_ACTIONS_ALWAYS_OFF,
  AGENT_ACTION_AREAS,
  AGENT_ACTION_DEFAULT_LEVEL,
  AGENT_ACTION_ROLES,
  agentActionAlwaysAsk,
  agentActionByKey,
  agentActionLevelsFor,
  agentLevelWord,
  agentActionKeys,
  PLAN_RULES,
  planRuleByKey,
  fetchAgentActionPolicies,
  setAgentActionPolicy,
} from '#/lib/agent-action-policy'
import type {
  AgentActionLevel,
  AgentActionPolicyRow,
} from '#/lib/agent-action-policy'
import { listApiCredentialsFn } from '#/lib/api-credential-admin'
import { notebookDataClient } from '#/lib/notebook-data'

const client = notebookDataClient

type PanelEntry = Pick<
  (typeof AGENT_ACTIONS)[number],
  'key' | 'label' | 'area' | 'description'
>

interface ActionRow {
  id: string
  entry: PanelEntry
  level: AgentActionLevel
}

/** The plan rules first, then every lab action by area. */
const PANEL_ENTRIES: readonly PanelEntry[] = [...PLAN_RULES, ...AGENT_ACTIONS]

/** Rows shown at a time: the list is long, so it is searched and paged. */
const PAGE_SIZE = 12

const PANEL_AREAS: readonly string[] = ['Plans', ...AGENT_ACTION_AREAS]

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export const AgentPermissionsPanel = memo(function AgentPermissionsPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()

  const policies = useQuery({
    queryKey: agentActionKeys.policies,
    queryFn: () => fetchAgentActionPolicies(client),
    enabled: Boolean(workspaceId),
  })

  const credentials = useQuery({
    queryKey: ['agent-actions', 'credentials', workspaceId],
    queryFn: async () => {
      try {
        return await listApiCredentialsFn({ data: { workspaceId } })
      } catch {
        return []
      }
    },
    enabled: Boolean(workspaceId) && canManage,
  })

  const [adding, setAdding] = useState(false)

  const save = useMutation({
    mutationFn: (input: {
      actionKey: string
      level: AgentActionLevel | 'default'
      role?: string | null
      credentialId?: string | null
    }) => setAgentActionPolicy(client, { workspaceId, ...input }),
    // The level changes on screen at once; a failure puts it back.
    onMutate: async (input) => {
      if (input.role || input.credentialId) return undefined

      await queryClient.cancelQueries({ queryKey: agentActionKeys.policies })

      const before = queryClient.getQueryData<AgentActionPolicyRow[]>(
        agentActionKeys.policies,
      )

      queryClient.setQueryData<AgentActionPolicyRow[]>(
        agentActionKeys.policies,
        (rows = []) => {
          const others = rows.filter(
            (row) =>
              !(
                row.subject_kind === 'everyone' &&
                row.action_key === input.actionKey
              ),
          )

          if (input.level === 'default') return others

          const existing = rows.find(
            (row) =>
              row.subject_kind === 'everyone' &&
              row.action_key === input.actionKey,
          )

          return [
            ...others,
            {
              id: existing?.id ?? `pending-${input.actionKey}`,
              workspace_id: workspaceId,
              action_key: input.actionKey,
              subject_kind: 'everyone' as const,
              role: null,
              credential_id: null,
              level: input.level,
              updated_by_user_id: null,
              created_at: existing?.created_at ?? '',
              updated_at: '',
            },
          ]
        },
      )

      return { before }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentActionKeys.policies })
      toast(t('agents.permissions.saved'))
    },
    onError: (error, _input, context) => {
      if (context?.before)
        queryClient.setQueryData(agentActionKeys.policies, context.before)

      toast.error(
        error instanceof Error
          ? error.message
          : t('agents.permissions.couldNotSave'),
      )
    },
  })

  const rows = policies.data ?? []

  const everyone = new Map(
    rows
      .filter((row) => row.subject_kind === 'everyone')
      .map((row) => [row.action_key, row.level] as const),
  )

  const exceptions = rows.filter((row) => row.subject_kind !== 'everyone')

  const credentialName = (id: string | null) =>
    credentials.data?.find((credential) => credential.id === id)?.name ??
    'Service credential'

  const [search, setSearch] = useState('')
  const [area, setArea] = useState('')
  const [page, setPage] = useState(0)

  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase()

    return PANEL_ENTRIES.filter(
      (entry) =>
        (area === '' || entry.area === area) &&
        (needle === '' ||
          entry.label.toLowerCase().includes(needle) ||
          entry.area.toLowerCase().includes(needle)),
    )
  }, [search, area])

  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const shown = Math.min(page, pageCount - 1)
  const start = shown * PAGE_SIZE

  const actionRows: RegistryRow<ActionRow>[] = matching
    .slice(start, start + PAGE_SIZE)
    .map((entry) => ({
      id: entry.key,
      entry,
      level: everyone.get(entry.key) ?? AGENT_ACTION_DEFAULT_LEVEL,
    }))

  const mutate = save.mutate
  const saving = save.isPending

  const actionColumns = useMemo<RegistryColumn<ActionRow>[]>(
    () => [
      {
        id: 'action',
        header: t('agents.permissions.action'),
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original.entry

          return (
            <Tooltip
              content={
                agentActionAlwaysAsk(entry.key)
                  ? `${entry.description} ${t('agents.permissions.alwaysAsk')}`
                  : entry.description
              }
            >
              <span className="block max-w-[40rem] truncate font-medium text-fg">
                {entry.label}
              </span>
            </Tooltip>
          )
        },
      },
      {
        id: 'area',
        header: t('agents.permissions.area'),
        size: 140,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-fg-muted">{row.original.entry.area}</span>
        ),
      },
      {
        id: 'level',
        header: t('agents.permissions.level'),
        size: 160,
        enableSorting: false,
        cell: ({ row }) => {
          const { entry, level } = row.original

          return (
            <Select
              size="sm"
              aria-label={`${entry.label}: ${t('agents.permissions.level')}`}
              value={level}
              disabled={!canManage}
              onChange={(event) => {
                const selectedLevel = agentActionLevelsFor(entry.key).find(
                  (value) => value === event.target.value,
                )

                if (!selectedLevel) return
                mutate({ actionKey: entry.key, level: selectedLevel })
              }}
            >
              {agentActionLevelsFor(entry.key).map((value) => (
                <option key={value} value={value}>
                  {agentLevelWord(entry.key, value)}
                </option>
              ))}
            </Select>
          )
        },
      },
    ],
    [canManage, mutate],
  )

  const exceptionColumns: RegistryColumn<AgentActionPolicyRow>[] = [
    {
      id: 'action',
      header: t('agents.permissions.exceptionAction'),
      accessorFn: (row) =>
        planRuleByKey(row.action_key)?.label ??
        agentActionByKey(row.action_key)?.label ??
        row.action_key,
    },
    {
      id: 'who',
      header: t('agents.permissions.exceptionWho'),
      accessorFn: (row) =>
        row.subject_kind === 'role'
          ? t('agents.permissions.exceptionRoleLabel', {
              role: titleCase(row.role ?? ''),
            })
          : t('agents.permissions.exceptionCredentialLabel', {
              name: credentialName(row.credential_id),
            }),
    },
    {
      id: 'level',
      header: t('agents.permissions.exceptionLevel'),
      accessorFn: (row) => agentLevelWord(row.action_key, row.level),
    },
    {
      id: 'remove',
      header: '',
      enableHiding: false,
      meta: { headerClassName: 'text-right', cellClassName: 'text-right' },
      cell: ({ row }) =>
        canManage ? (
          <Button
            size="sm"
            variant="danger"
            disabled={saving}
            onClick={() =>
              save.mutate({
                actionKey: row.original.action_key,
                level: 'default',
                role: row.original.role,
                credentialId: row.original.credential_id,
              })
            }
          >
            {t('agents.permissions.exceptionRemove')}
          </Button>
        ) : null,
    },
  ]

  return (
    <Section title={t('agents.permissions.title')}>
      <Muted>{t('agents.permissions.intro')}</Muted>
      {!canManage ? <Notice>{t('agents.permissions.viewOnly')}</Notice> : null}
      {policies.error ? (
        <Notice tone="bad">{t('agents.permissions.loadError')}</Notice>
      ) : policies.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
              }}
              placeholder={t('agents.permissions.searchPlaceholder')}
              aria-label={t('agents.permissions.searchPlaceholder')}
              className="max-w-64 min-w-40 flex-1"
            />
            <Select
              size="sm"
              value={area}
              onChange={(event) => {
                setArea(event.target.value)
                setPage(0)
              }}
              aria-label={t('agents.permissions.area')}
              className="w-auto"
            >
              <option value="">{t('agents.permissions.allAreas')}</option>
              {PANEL_AREAS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
          <TableBox>
            <RegistryGrid
              label={t('agents.permissions.tableLabel')}
              rows={actionRows}
              columns={actionColumns}
              getRowId={(row) => row.id}
              selectable={false}
              sortable={false}
              empty={t('agents.permissions.noMatches')}
            />
          </TableBox>
          <div className="flex flex-wrap items-center gap-3 text-label text-fg-muted">
            <span>
              {t('agents.permissions.showing', {
                start: matching.length === 0 ? 0 : start + 1,
                end: Math.min(start + PAGE_SIZE, matching.length),
                total: matching.length,
              })}
            </span>
            <Button
              size="sm"
              disabled={shown === 0}
              onClick={() => setPage(shown - 1)}
            >
              {t('common.actions.previous')}
            </Button>
            <Button
              size="sm"
              disabled={shown >= pageCount - 1}
              onClick={() => setPage(shown + 1)}
            >
              {t('common.actions.next')}
            </Button>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h3 className="m-0 text-body font-semibold">
                {t('agents.permissions.exceptionsTitle')}
              </h3>
              <Muted>{t('agents.permissions.exceptionsIntro')}</Muted>
            </div>
            {canManage ? (
              <Button icon="plus" onClick={() => setAdding(true)}>
                {t('agents.permissions.exceptionAdd')}
              </Button>
            ) : null}
          </div>
          {exceptions.length === 0 ? (
            <Muted>{t('agents.permissions.exceptionNone')}</Muted>
          ) : (
            <TableBox>
              <RegistryGrid
                label={t('agents.permissions.exceptionsTitle')}
                rows={exceptions}
                columns={exceptionColumns}
                getRowId={(row) => row.id}
                selectable={false}
              />
            </TableBox>
          )}

          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-body font-semibold">
              {t('agents.permissions.alwaysOffTitle')}
            </h3>
            <Muted>{t('agents.permissions.alwaysOffIntro')}</Muted>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-body">
              {AGENT_ACTIONS_ALWAYS_OFF.map((item) => (
                <li key={item.label}>
                  <span className="font-medium">{item.label}</span>
                  <span className="text-fg-muted"> · {item.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {adding ? (
        <AddException
          credentials={(credentials.data ?? []).map((credential) => ({
            id: credential.id,
            name: credential.name,
          }))}
          pending={save.isPending}
          onClose={() => setAdding(false)}
          onAdd={(input) =>
            save.mutate(input, { onSuccess: () => setAdding(false) })
          }
        />
      ) : null}
    </Section>
  )
})

function AddException({
  credentials,
  pending,
  onClose,
  onAdd,
}: {
  credentials: { id: string; name: string }[]
  pending: boolean
  onClose: () => void
  onAdd: (input: {
    actionKey: string
    level: AgentActionLevel
    role: string | null
    credentialId: string | null
  }) => void
}) {
  const [actionKey, setActionKey] = useState('')
  const [kind, setKind] = useState<'role' | 'credential'>('role')
  const [role, setRole] = useState('')
  const [credentialId, setCredentialId] = useState('')
  const [level, setLevel] = useState<AgentActionLevel>('auto')

  const ready =
    actionKey !== '' && (kind === 'role' ? role !== '' : credentialId !== '')

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader title={t('agents.permissions.exceptionAdd')} />
        <DialogBody className="flex flex-col gap-3">
          <Field label={t('agents.permissions.exceptionAction')}>
            <Select
              value={actionKey}
              onChange={(event) => {
                setActionKey(event.target.value)

                if (
                  level === 'auto' &&
                  agentActionAlwaysAsk(event.target.value)
                )
                  setLevel('ask')
              }}
            >
              <option value="">
                {t('agents.permissions.exceptionPickAction')}
              </option>
              {PANEL_ENTRIES.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('agents.permissions.exceptionWho')}>
            <Select
              value={kind}
              onChange={(event) => {
                const value = event.target.value

                if (value === 'role' || value === 'credential') setKind(value)
              }}
            >
              <option value="role">
                {t('agents.permissions.exceptionRole')}
              </option>
              <option value="credential">
                {t('agents.permissions.exceptionCredential')}
              </option>
            </Select>
          </Field>
          {kind === 'role' ? (
            <Field label={t('agents.permissions.exceptionRoleName')}>
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="">
                  {t('agents.permissions.exceptionPickRole')}
                </option>
                {AGENT_ACTION_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label={t('agents.permissions.exceptionCredentialName')}>
              <Select
                value={credentialId}
                onChange={(event) => setCredentialId(event.target.value)}
              >
                <option value="">
                  {t('agents.permissions.exceptionPickCredential')}
                </option>
                {credentials.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {credential.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label={t('agents.permissions.exceptionLevel')}
            hint={t(`agents.permissions.levelHint.${level}`)}
          >
            <Select
              value={level}
              onChange={(event) => {
                const selectedLevel = agentActionLevelsFor(actionKey).find(
                  (option) => option === event.target.value,
                )

                if (selectedLevel) setLevel(selectedLevel)
              }}
            >
              {agentActionLevelsFor(actionKey).map((value) => (
                <option key={value} value={value}>
                  {agentLevelWord(actionKey, value)}
                </option>
              ))}
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('agents.permissions.exceptionCancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || pending}
            onClick={() =>
              onAdd({
                actionKey,
                level,
                role: kind === 'role' ? role : null,
                credentialId: kind === 'credential' ? credentialId : null,
              })
            }
          >
            {t('agents.permissions.exceptionSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
