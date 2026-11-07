/**
 * Settings > AI > Agent permissions: for every action an agent can take in the
 * lab, Auto (runs straight away), Ask (waits for a person) or Never. One
 * setting for everyone, with exceptions for a role or a service credential.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Tooltip } from '#/components/ui/tooltip'
import { t } from '#/copy'
import {
  AGENT_ACTIONS,
  AGENT_ACTIONS_ALWAYS_OFF,
  AGENT_ACTION_AREAS,
  AGENT_ACTION_DEFAULT_LEVEL,
  AGENT_ACTION_LEVELS,
  AGENT_ACTION_ROLES,
  agentActionByKey,
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
            <Table caption={t('agents.permissions.tableLabel')}>
              <TableHeader>
                <tr>
                  <TableHead>{t('agents.permissions.action')}</TableHead>
                  <TableHead className="w-40">
                    {t('agents.permissions.level')}
                  </TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {AGENT_ACTION_AREAS.map((area) => {
                  const inArea = AGENT_ACTIONS.filter(
                    (entry) => entry.area === area,
                  )
                  if (inArea.length === 0) return null
                  return [
                    <TableRow key={`area-${area}`}>
                      <TableCell
                        colSpan={2}
                        className="bg-surface-hover text-label font-medium text-fg-muted"
                      >
                        {area}
                      </TableCell>
                    </TableRow>,
                    ...inArea.map((entry) => {
                      const level =
                        everyone.get(entry.key) ?? AGENT_ACTION_DEFAULT_LEVEL
                      return (
                        <TableRow key={entry.key}>
                          <TableCell>
                            <Tooltip content={entry.description}>
                              <span className="block max-w-[40rem] truncate font-medium text-fg">
                                {entry.label}
                              </span>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Select
                              size="sm"
                              aria-label={`${entry.label}: ${t('agents.permissions.level')}`}
                              value={level}
                              disabled={!canManage || save.isPending}
                              onChange={(event) =>
                                save.mutate({
                                  actionKey: entry.key,
                                  level: event.target.value as AgentActionLevel,
                                })
                              }
                            >
                              {AGENT_ACTION_LEVELS.map((value) => (
                                <option key={value} value={value}>
                                  {LEVEL_LABEL[value]}
                                </option>
                              ))}
                            </Select>
                          </TableCell>
                        </TableRow>
                      )
                    }),
                  ]
                })}
              </TableBody>
            </Table>
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
              <Table caption={t('agents.permissions.exceptionsTitle')}>
                <TableHeader>
                  <tr>
                    <TableHead>
                      {t('agents.permissions.exceptionAction')}
                    </TableHead>
                    <TableHead>
                      {t('agents.permissions.exceptionWho')}
                    </TableHead>
                    <TableHead>
                      {t('agents.permissions.exceptionLevel')}
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">
                        {t('agents.permissions.exceptionRemove')}
                      </span>
                    </TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {exceptions.map((row: AgentActionPolicyRow) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        {agentActionByKey(row.action_key)?.label ??
                          row.action_key}
                      </TableCell>
                      <TableCell>
                        {row.subject_kind === 'role'
                          ? t('agents.permissions.exceptionRoleLabel', {
                              role: titleCase(row.role ?? ''),
                            })
                          : t('agents.permissions.exceptionCredentialLabel', {
                              name: credentialName(row.credential_id),
                            })}
                      </TableCell>
                      <TableCell>{LEVEL_LABEL[row.level]}</TableCell>
                      <TableCell className="text-right">
                        {canManage ? (
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={save.isPending}
                            onClick={() =>
                              save.mutate({
                                actionKey: row.action_key,
                                level: 'default',
                                role: row.role,
                                credentialId: row.credential_id,
                              })
                            }
                          >
                            {t('agents.permissions.exceptionRemove')}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              onChange={(event) => setActionKey(event.target.value)}
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
              onChange={(event) =>
                setKind(event.target.value as 'role' | 'credential')
              }
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
              onChange={(event) =>
                setLevel(event.target.value as AgentActionLevel)
              }
            >
              {AGENT_ACTION_LEVELS.map((value) => (
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
