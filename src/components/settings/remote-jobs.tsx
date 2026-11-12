import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
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
import { Status } from '#/components/ui/status'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { toast } from '#/components/ui/sonner'
import { CheckRow } from '#/components/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import { setConnectorSecretFn } from '#/lib/connector-secret-admin'
import {
  describeConnectorsError,
  registerConnector,
  updateConnector,
} from '#/lib/connectors/client'
import {
  fetchLakehouseSettings,
  fetchRemoteConnections,
  remoteKeys,
  setLakehouseSql,
} from '#/lib/pipelines/remote/client'
import type {
  HpcConnectorConfig,
  RemoteConnectionOption,
} from '#/lib/pipelines/remote/client'
import { formatQueues, parseQueues } from '#/lib/pipelines/remote/queues'
import {
  DEFAULT_REMOTE_SECRET,
  REMOTE_CONNECTION_RE,
  REMOTE_SECRET_RE,
} from '#/lib/pipelines/remote/settings'
import { sealedSecretName } from '#/lib/pipelines/remote/secret'
import { t } from '#/copy'

const dataClient = createDataClient()

interface Draft {
  id: string | null
  key: string
  name: string
  baseUrl: string
  user: string
  queues: string
  callbackUrl: string
  /** The name pipelines give the secret, such as HPC_SUBMIT_KEY. */
  secretName: string
  /** The secrets already sealed on the connection, by name. */
  secrets: string[]
  token: string
}

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

const emptyDraft = (): Draft => ({
  id: null,
  key: '',
  name: '',
  baseUrl: '',
  user: '',
  queues: '',
  callbackUrl: '',
  secretName: DEFAULT_REMOTE_SECRET,
  secrets: [],
  token: '',
})

const draftOf = (c: RemoteConnectionOption): Draft => ({
  id: c.id,
  key: c.key,
  name: c.name,
  baseUrl: c.baseUrl,
  user: c.user,
  queues: formatQueues(c.queues),
  callbackUrl: c.callbackUrl,
  secretName: c.secrets.at(0) ?? DEFAULT_REMOTE_SECRET,
  secrets: c.secrets,
  token: '',
})

/** The clusters pipelines can send jobs to: where, which queues, and a sealed token. */
export function RemoteJobConnections({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<RemoteConnectionOption | null>(null)

  const connections = useQuery({
    queryKey: [...remoteKeys.connections, workspaceId],
    queryFn: () => fetchRemoteConnections(dataClient),
  })

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: remoteKeys.connections })

  const remove = useMutation({
    mutationFn: (connection: RemoteConnectionOption) =>
      updateConnector(dataClient, {
        workspaceId,
        connectorId: connection.id,
        status: 'archived',
      }),
    onSuccess: () => {
      toast(t('features.pipelineRemote.settings.removed'))
      setRemoving(null)
      void refresh()
    },
    onError: (cause) => toast(describeConnectorsError(cause)),
  })

  const rows = connections.data ?? []

  return (
    <Section
      title={t('features.pipelineRemote.settings.connectionsTitle')}
      count={rows.length}
      action={
        canManage ? (
          <Button size="sm" icon="plus" onClick={() => setDraft(emptyDraft())}>
            {t('features.pipelineRemote.settings.addConnection')}
          </Button>
        ) : null
      }
    >
      <Muted>{t('features.pipelineRemote.settings.connectionsHint')}</Muted>
      {connections.isSuccess && rows.length === 0 ? (
        <Muted>{t('features.pipelineRemote.settings.empty')}</Muted>
      ) : null}
      {rows.length > 0 ? (
        <RegistryGrid
          label={t('features.pipelineRemote.settings.connectionsTitle')}
          rows={rows}
          columns={connectionColumns(canManage, setDraft, setRemoving)}
          getRowId={(c) => c.id}
          selectable={false}
        />
      ) : null}
      {draft ? (
        <ConnectionDialog
          workspaceId={workspaceId}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null)
            void refresh()
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('features.pipelineRemote.settings.removeTitle', {
                name: removing?.name ?? '',
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('features.pipelineRemote.settings.removeBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                if (removing) remove.mutate(removing)
              }}
            >
              {t('features.pipelineRemote.settings.remove')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Section>
  )
}

/** The connections as the shared table shows them: name, key, state, queues, actions. */
function connectionColumns(
  canManage: boolean,
  onEdit: (draft: Draft) => void,
  onRemove: (connection: RemoteConnectionOption) => void,
): RegistryColumn<RemoteConnectionOption>[] {
  const columns: RegistryColumn<RemoteConnectionOption>[] = [
    {
      id: 'name',
      header: t('features.pipelineRemote.settings.columnName'),
      cell: ({ row }) => row.original.name,
    },
    {
      id: 'key',
      header: t('features.pipelineRemote.settings.columnKey'),
      cell: ({ row }) => <span className="mono">{row.original.key}</span>,
    },
    {
      id: 'status',
      header: t('features.pipelineRemote.settings.columnStatus'),
      cell: ({ row }) => (
        <Status tone={row.original.status === 'active' ? 'ok' : 'draft'}>
          {row.original.status}
        </Status>
      ),
    },
    {
      id: 'queues',
      header: t('features.pipelineRemote.settings.columnQueues'),
      cell: ({ row }) => row.original.queues.map((q) => q.name).join(', '),
    },
  ]

  if (canManage)
    columns.push({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <span className="flex gap-2">
          <Button size="sm" onClick={() => onEdit(draftOf(row.original))}>
            {t('common.actions.edit')}
          </Button>
          <Button size="sm" onClick={() => onRemove(row.original)}>
            {t('features.pipelineRemote.settings.remove')}
          </Button>
        </span>
      ),
    })

  return columns
}

function ConnectionDialog({
  workspaceId,
  draft: initial,
  onClose,
  onSaved,
}: {
  workspaceId: string
  draft: Draft
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const set = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }))
  const editing = initial.id !== null
  const queues = parseQueues(draft.queues)

  const valid =
    draft.name.trim().length > 0 &&
    REMOTE_CONNECTION_RE.test(draft.key) &&
    draft.baseUrl.trim().length > 0 &&
    draft.user.trim().length > 0 &&
    queues !== null &&
    REMOTE_SECRET_RE.test(draft.secretName) &&
    (editing || draft.token.trim().length > 0)

  const save = useMutation({
    mutationFn: async () => {
      const config: HpcConnectorConfig = {
        adapter: 'hpc',
        scheduler: 'slurm',
        baseUrl: draft.baseUrl.trim(),
        user: draft.user.trim(),
        queues: queues ?? [],
        secrets: draft.token.trim()
          ? [...new Set([...draft.secrets, draft.secretName])]
          : draft.secrets,
      }

      if (draft.callbackUrl.trim())
        config.callbackUrl = draft.callbackUrl.trim()

      const connector = draft.id
        ? await updateConnector(dataClient, {
            workspaceId,
            connectorId: draft.id,
            name: draft.name.trim(),
            config,
          })
        : await registerConnector(dataClient, {
            workspaceId,
            key: draft.key,
            name: draft.name.trim(),
            connectorType: 'custom',
            direction: 'outbound',
            config,
          })

      if (draft.token.trim())
        await setConnectorSecretFn({
          data: {
            workspaceId,
            connectorId: connector.id,
            secretName: sealedSecretName(draft.secretName),
            value: draft.token.trim(),
          },
        })
    },
    onSuccess: () => {
      toast(t('features.pipelineRemote.settings.saved'))
      onSaved()
    },
    onError: (cause) => toast(describeConnectorsError(cause)),
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('features.pipelineRemote.settings.addConnection')}
          description={t('features.pipelineRemote.settings.connectionsHint')}
        />
        <DialogBody>
          <Field label={t('features.pipelineRemote.settings.name')} required>
            <Input
              value={draft.name}
              onChange={(e) => {
                const next: Partial<Draft> = { name: e.target.value }

                if (!editing) next.key = slugOf(e.target.value)
                set(next)
              }}
            />
          </Field>
          <Field
            label={t('features.pipelineRemote.settings.key')}
            required
            hint={t('features.pipelineRemote.settings.keyHint')}
          >
            <Input
              value={draft.key}
              disabled={editing}
              onChange={(e) => set({ key: e.target.value })}
            />
          </Field>
          <Field
            label={t('features.pipelineRemote.settings.baseUrl')}
            required
            hint={t('features.pipelineRemote.settings.baseUrlHint')}
          >
            <Input
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </Field>
          <Field label={t('features.pipelineRemote.settings.user')} required>
            <Input
              value={draft.user}
              onChange={(e) => set({ user: e.target.value })}
            />
          </Field>
          <Field
            label={t('features.pipelineRemote.settings.queues')}
            required
            hint={t('features.pipelineRemote.settings.queuesHint')}
          >
            <Input
              value={draft.queues}
              onChange={(e) => set({ queues: e.target.value })}
            />
          </Field>
          <Field
            label={t('features.pipelineRemote.settings.callbackUrl')}
            hint={t('features.pipelineRemote.settings.callbackUrlHint')}
          >
            <Input
              value={draft.callbackUrl}
              onChange={(e) => set({ callbackUrl: e.target.value })}
            />
          </Field>
          <Field
            label={t('features.pipelineRemote.settings.secretName')}
            hint={t('features.pipelineRemote.settings.secretNameHint')}
          >
            <Input
              className="mono"
              value={draft.secretName}
              onChange={(e) => set({ secretName: e.target.value })}
            />
          </Field>
          <Field
            label={t('features.pipelineRemote.settings.token')}
            required={!editing}
            hint={
              editing
                ? t('features.pipelineRemote.settings.tokenKeep')
                : t('features.pipelineRemote.settings.tokenHint')
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={draft.token}
              onChange={(e) => set({ token: e.target.value })}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button>{t('common.actions.cancel')}</Button>} />
          <Button
            variant="primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('features.pipelineRemote.settings.saving')
              : t('features.pipelineRemote.settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The steward's switch for SQL over the open tables in pipelines. */
export function LakehouseSqlSection({
  workspaceId,
  canManage,
  dataAccess,
}: {
  workspaceId: string
  canManage: boolean
  dataAccess: boolean
}) {
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: [...remoteKeys.lakehouse, workspaceId],
    queryFn: () => fetchLakehouseSettings(dataClient, workspaceId),
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      setLakehouseSql(dataClient, workspaceId, enabled),
    onSuccess: () => {
      toast(t('features.pipelineRemote.settings.lakeSaved'))
      void queryClient.invalidateQueries({ queryKey: remoteKeys.lakehouse })
    },
    onError: (cause) => toast(describeConnectorsError(cause)),
  })

  const editable = canManage && dataAccess

  return (
    <Section title={t('features.pipelineRemote.settings.lakeTitle')}>
      <Muted>{t('features.pipelineRemote.settings.lakeHint')}</Muted>
      <CheckRow
        title={t('features.pipelineRemote.settings.lakeSwitch')}
        body={
          settings.data && !settings.data.lakeEnabled
            ? t('features.pipelineRemote.settings.lakeNeedsOpenTables')
            : settings.data
              ? t('features.pipelineRemote.settings.lakeTables', {
                  n: settings.data.tableCount,
                })
              : ''
        }
        checked={settings.data?.enabled === true}
        disabled={!editable || settings.isPending || toggle.isPending}
        onCheckedChange={(v) => toggle.mutate(v)}
      />
    </Section>
  )
}
