/**
 * Settings > AI > Agent permissions: for every action an agent can take in the
 * lab, Auto (runs straight away), Ask (waits for a person) or Never. One
 * setting for everyone, with exceptions for a role or a service credential.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { RegistryGrid, bandRow } from '#/components/inventory/registry-grid'
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
import { Field } from '#/components/ui/input'
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
  agentActionKeys,
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

interface ActionRow {
  id: string
  entry: (typeof AGENT_ACTIONS)[number]
  level: AgentActionLevel
}

const LEVEL_LABEL: Record<AgentActionLevel, string> = {
  auto: t('agents.permissions.levels.auto'),
  ask: t('agents.permissions.levels.ask'),
  never: t('agents.permissions.levels.never'),
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function AgentPermissionsPanel({
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentActionKeys.policies })
      toast(t('agents.permissions.saved'))
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('agents.permissions.couldNotSave'),
      ),
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

  const actionRows: RegistryRow<ActionRow>[] = AGENT_ACTION_AREAS.flatMap(
    (area) => {
      const inArea = AGENT_ACTIONS.filter((entry) => entry.area === area)

      if (inArea.length === 0) return []

      return [
        bandRow(area),
        ...inArea.map((entry) => ({
          id: entry.key,
          entry,
          level: everyone.get(entry.key) ?? AGENT_ACTION_DEFAULT_LEVEL,
        })),
      ]
    },
  )

  const actionColumns: RegistryColumn<ActionRow>[] = [
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
            disabled={!canManage || save.isPending}
            onChange={(event) => {
              const selectedLevel = agentActionLevelsFor(entry.key).find(
                (value) => value === event.target.value,
              )

              if (!selectedLevel) return
              save.mutate({ actionKey: entry.key, level: selectedLevel })
            }}
          >
            {agentActionLevelsFor(entry.key).map((value) => (
              <option key={value} value={value}>
                {LEVEL_LABEL[value]}
              </option>
            ))}
          </Select>
        )
      },
    },
  ]

  const exceptionColumns: RegistryColumn<AgentActionPolicyRow>[] = [
    {
      id: 'action',
      header: t('agents.permissions.exceptionAction'),
      accessorFn: (row) =>
        agentActionByKey(row.action_key)?.label ?? row.action_key,
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
      accessorFn: (row) => LEVEL_LABEL[row.level],
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
            disabled={save.isPending}
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
          <TableBox>
            <RegistryGrid
              label={t('agents.permissions.tableLabel')}
              rows={actionRows}
              columns={actionColumns}
              getRowId={(row) => row.id}
              selectable={false}
            />
          </TableBox>

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
}

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
              {AGENT_ACTIONS.map((entry) => (
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
                  {LEVEL_LABEL[value]}
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
