import { useRef, useState } from 'react'
import { z } from 'zod'
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
import { Notice } from '#/components/ui/alert'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { Icon } from '#/components/icons'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { SettingsBody } from '#/components/settings/settings-page'
import { createDataClient } from '#/lib/data-client'
import {
  deletePipelineConnectionSecretFn,
  setPipelineConnectionSecretFn,
} from '#/lib/pipeline-connection-secret-admin'
import { WEB_CONNECTION_KEY_RE } from '#/lib/pipelines/web-call'
import { formatQueues, parseQueues } from '#/lib/pipelines/remote/queues'
import {
  REMOTE_CONNECTION_RE,
  REMOTE_SECRET_RE,
} from '#/lib/pipelines/remote/settings'
import type { HpcSettings } from '#/lib/pipelines/remote/client'
import { t } from '#/copy'

const client = createDataClient()

interface Connection {
  id: string
  key: string
  name: string
  description: string | null
  base_url: string
  status: string
  secret_names: string[]
  /** `web`: an https address a web call reaches. `hpc`: a cluster a remote job runs on. */
  kind: 'web' | 'hpc'
  settings: unknown
}

const hpcSettings = z.object({
  user: z.string().catch(''),
  queues: z
    .array(
      z.object({
        name: z.string(),
        maxMinutes: z.number().int().positive().optional(),
      }),
    )
    .catch([]),
  callbackUrl: z.string().catch(''),
})

const WEB_ADDRESS = /^https:\/\/[^\s/@?#]+(\/[^\s?#]*)?$/
const HPC_ADDRESS = /^https?:\/\/[^\s/@?#]+(\/[^\s?#]*)?$/

const KEY = ['pipeline-connections'] as const

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 49)

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * Settings → Integrations → Pipeline connections: the https addresses pipeline
 * web call steps may reach, and the names of the secrets each signs with. A
 * secret's value is typed here once and sealed; nobody can read it back.
 */
export function PipelineConnections({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const [editing, setEditing] = useState<Connection | 'new' | null>(null)

  const query = useQuery({
    queryKey: KEY,
    queryFn: () =>
      client.list<Connection>(
        'pipeline_connections',
        '?select=id,key,name,description,base_url,status,secret_names,kind,settings&order=name.asc',
      ),
    enabled: Boolean(workspaceId),
  })

  const rows = query.data ?? []

  const columns: RegistryColumn<Connection>[] = [
    {
      id: 'name',
      header: t('features.pipelineConnections.settings.name'),
      cell: ({ row }) =>
        canManage ? (
          <button
            type="button"
            className="link"
            onClick={() => setEditing(row.original)}
          >
            {row.original.name}
          </button>
        ) : (
          row.original.name
        ),
    },
    {
      id: 'key',
      header: t('features.pipelineConnections.settings.key'),
      cell: ({ row }) => <span className="mono">{row.original.key}</span>,
    },
    {
      id: 'kind',
      header: t('features.pipelineConnections.settings.type'),
      cell: ({ row }) =>
        row.original.kind === 'hpc'
          ? t('features.pipelineConnections.settings.typeHpc')
          : t('features.pipelineConnections.settings.typeWeb'),
    },
    {
      id: 'address',
      header: t('features.pipelineConnections.settings.address'),
      cell: ({ row }) => <span className="mono">{row.original.base_url}</span>,
    },
    {
      id: 'secrets',
      header: t('features.pipelineConnections.settings.secrets'),
      cell: ({ row }) =>
        row.original.secret_names.length ? (
          <span className="mono">{row.original.secret_names.join(', ')}</span>
        ) : (
          <Muted>{t('features.pipelineConnections.settings.noSecrets')}</Muted>
        ),
    },
    {
      id: 'status',
      header: t('features.pipelineConnections.settings.status'),
      cell: ({ row }) => (
        <Status tone={row.original.status === 'active' ? 'ok' : 'stored'}>
          {row.original.status === 'active'
            ? t('features.pipelineConnections.settings.on')
            : t('features.pipelineConnections.settings.off')}
        </Status>
      ),
    },
  ]

  // The open dialog reads the live row, so a secret set inside it shows at once.
  const live =
    editing && editing !== 'new'
      ? (rows.find((row) => row.id === editing.id) ?? editing)
      : editing

  return (
    <>
      <SettingsBody className="gap-3 border-t border-border-subtle pb-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-section">
            {t('features.pipelineConnections.settings.title')}
          </h2>
          {canManage ? (
            <Button icon="plus" onClick={() => setEditing('new')}>
              {t('features.pipelineConnections.settings.add')}
            </Button>
          ) : null}
        </div>
        <Muted>{t('features.pipelineConnections.settings.hint')}</Muted>
      </SettingsBody>
      {rows.length ? (
        <div className="min-h-0 shrink-0">
          <RegistryGrid
            label={t('features.pipelineConnections.settings.title')}
            rows={rows}
            columns={columns}
            getRowId={(row) => row.id}
            selectable={false}
          />
        </div>
      ) : (
        <SettingsBody className="pb-4">
          <Muted>
            {query.isLoading
              ? t('features.pipelineConnections.settings.loading')
              : t('features.pipelineConnections.settings.none')}
          </Muted>
        </SettingsBody>
      )}
      {live ? (
        <ConnectionDialog
          key={live === 'new' ? 'new' : live.id}
          workspaceId={workspaceId}
          connection={live === 'new' ? null : live}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

function useConnectionActions({
  workspaceId,
  connection,
  form,
  onClose,
  onError,
}: {
  workspaceId: string
  connection: Connection | null
  form: {
    name: string
    key: string
    address: string
    description: string
    kind: 'web' | 'hpc'
    /** Cluster connections only. */
    settings: HpcSettings | null
  }
  onClose: () => void
  onError: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY })

  const save = useMutation({
    mutationFn: async () => {
      if (connection)
        await client.rpc('update_pipeline_connection', {
          p_workspace_id: workspaceId,
          p_connection_id: connection.id,
          p_name: form.name,
          p_base_url: form.address,
          p_description: form.description,
          p_settings: form.settings ?? undefined,
        })
      else
        await client.rpc('create_pipeline_connection', {
          p_workspace_id: workspaceId,
          p_key: form.key,
          p_name: form.name,
          p_base_url: form.address,
          p_description: form.description || null,
          p_kind: form.kind,
          p_settings: form.settings ?? undefined,
        })
    },
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (cause) => onError(message(cause)),
  })

  const toggle = useMutation({
    mutationFn: () =>
      client.rpc('update_pipeline_connection', {
        p_workspace_id: workspaceId,
        p_connection_id: connection?.id,
        p_status: connection?.status === 'active' ? 'off' : 'active',
      }),
    onSuccess: refresh,
    onError: (cause) => onError(message(cause)),
  })

  const remove = useMutation({
    mutationFn: () =>
      client.rpc('delete_pipeline_connection', {
        p_workspace_id: workspaceId,
        p_connection_id: connection?.id,
      }),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (cause) => onError(message(cause)),
  })

  return { refresh, save, toggle, remove }
}

function useClusterForm(connection: Connection | null, kind: 'web' | 'hpc') {
  const current = hpcSettings.safeParse(connection?.settings ?? {})
  const [user, setUser] = useState(current.success ? current.data.user : '')

  const [queueText, setQueueText] = useState(
    current.success ? formatQueues(current.data.queues) : '',
  )

  const [callbackUrl, setCallbackUrl] = useState(
    current.success ? current.data.callbackUrl : '',
  )

  const queues = parseQueues(queueText)

  const settings: HpcSettings | null =
    kind === 'hpc' && queues
      ? {
          scheduler: 'slurm',
          user: user.trim(),
          queues,
          callbackUrl: callbackUrl.trim() || undefined,
        }
      : null

  return {
    user,
    setUser,
    queueText,
    setQueueText,
    callbackUrl,
    setCallbackUrl,
    queues,
    settings,
  }
}

function ClusterFields({
  cluster,
}: {
  cluster: ReturnType<typeof useClusterForm>
}) {
  const {
    user,
    setUser,
    queueText,
    setQueueText,
    callbackUrl,
    setCallbackUrl,
    queues,
  } = cluster

  return (
    <>
      <Field label={t('features.pipelineConnections.settings.user')} required>
        <Input value={user} onChange={(event) => setUser(event.target.value)} />
      </Field>
      <Field
        label={t('features.pipelineConnections.settings.queues')}
        hint={t('features.pipelineConnections.settings.queuesHint')}
        required
        error={
          queues === null
            ? t('features.pipelineConnections.settings.queuesInvalid')
            : undefined
        }
      >
        <Input
          className="mono"
          value={queueText}
          placeholder={t(
            'features.pipelineConnections.settings.queuesPlaceholder',
          )}
          onChange={(event) => setQueueText(event.target.value)}
        />
      </Field>
      <Field
        label={t('features.pipelineConnections.settings.callbackUrl')}
        hint={t('features.pipelineConnections.settings.callbackUrlHint')}
      >
        <Input
          value={callbackUrl}
          onChange={(event) => setCallbackUrl(event.target.value)}
        />
      </Field>
    </>
  )
}

function connectionValid(form: {
  name: string
  address: string
  key: string
  kind: 'web' | 'hpc'
  settings: HpcSettings | null
  existing: boolean
}): boolean {
  const hpc = form.kind === 'hpc'

  if (form.name.trim() === '') return false

  if (!(hpc ? HPC_ADDRESS : WEB_ADDRESS).test(form.address)) return false

  if (
    !form.existing &&
    !(hpc ? REMOTE_CONNECTION_RE : WEB_CONNECTION_KEY_RE).test(form.key)
  )
    return false

  return !hpc || (form.settings !== null && form.settings.user !== '')
}

function AddressField({
  kind,
  value,
  onChange,
}: {
  kind: 'web' | 'hpc'
  value: string
  onChange: (value: string) => void
}) {
  const hpc = kind === 'hpc'

  return (
    <Field
      label={t('features.pipelineConnections.settings.address')}
      hint={t(
        hpc
          ? 'features.pipelineConnections.settings.addressHintHpc'
          : 'features.pipelineConnections.settings.addressHint',
      )}
      required
    >
      <Input
        value={value}
        placeholder={
          hpc ? 'https://slurm.example.org' : 'https://lims.example.com/api'
        }
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function ConnectionDialog({
  workspaceId,
  connection,
  onClose,
}: {
  workspaceId: string
  connection: Connection | null
  onClose: () => void
}) {
  const [name, setName] = useState(connection?.name ?? '')
  const [key, setKey] = useState(connection?.key ?? '')
  // The key follows the name until a person types their own.
  const keyEdited = useRef(false)
  const [address, setAddress] = useState(connection?.base_url ?? '')
  const [description, setDescription] = useState(connection?.description ?? '')
  const [kind, setKind] = useState<'web' | 'hpc'>(connection?.kind ?? 'web')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  const cluster = useClusterForm(connection, kind)
  const { settings } = cluster

  const { refresh, save, toggle, remove } = useConnectionActions({
    workspaceId,
    connection,
    form: { name, key, address, description, kind, settings },
    onClose,
    onError: setError,
  })

  const valid = connectionValid({
    name,
    address,
    key,
    kind,
    settings,
    existing: connection !== null,
  })

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={
            connection
              ? connection.name
              : t('features.pipelineConnections.settings.addTitle')
          }
          description={t('features.pipelineConnections.settings.dialogHint')}
        />
        <DialogBody>
          <Field
            label={t('features.pipelineConnections.settings.name')}
            required
          >
            <Input
              value={name}
              placeholder={t(
                'features.pipelineConnections.settings.namePlaceholder',
              )}
              onChange={(event) => {
                setName(event.target.value)

                if (!connection && !keyEdited.current)
                  setKey(slug(event.target.value))
              }}
            />
          </Field>
          {connection ? null : (
            <Field label={t('features.pipelineConnections.settings.type')}>
              <Select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value === 'hpc' ? 'hpc' : 'web')
                }
              >
                <option value="web">
                  {t('features.pipelineConnections.settings.typeWeb')}
                </option>
                <option value="hpc">
                  {t('features.pipelineConnections.settings.typeHpc')}
                </option>
              </Select>
            </Field>
          )}
          {connection ? null : (
            <Field
              label={t('features.pipelineConnections.settings.key')}
              hint={t('features.pipelineConnections.settings.keyHint')}
              required
            >
              <Input
                value={key}
                placeholder="lims"
                onChange={(event) => {
                  keyEdited.current = true
                  setKey(event.target.value.toLowerCase().replaceAll(' ', '-'))
                }}
              />
            </Field>
          )}
          <AddressField kind={kind} value={address} onChange={setAddress} />
          {kind === 'hpc' ? <ClusterFields cluster={cluster} /> : null}
          <Field label={t('features.pipelineConnections.settings.description')}>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          {connection ? (
            <SecretsEditor
              workspaceId={workspaceId}
              connection={connection}
              onChanged={refresh}
              onError={setError}
            />
          ) : (
            <Muted>
              {t('features.pipelineConnections.settings.secretsAfter')}
            </Muted>
          )}
          {error ? <Notice tone="bad">{error}</Notice> : null}
        </DialogBody>
        <ConnectionFooter
          connection={connection}
          valid={valid}
          saving={save.isPending}
          switching={toggle.isPending}
          removing={remove.isPending}
          onSave={() => save.mutate()}
          onToggle={() => toggle.mutate()}
          onRemove={() => setRemoving(true)}
        />
        <RemoveConfirm
          open={removing}
          name={connection?.name ?? ''}
          onOpenChange={setRemoving}
          onConfirm={() => remove.mutate()}
        />
      </DialogContent>
    </Dialog>
  )
}

function ConnectionFooter({
  connection,
  valid,
  saving,
  switching,
  removing,
  onSave,
  onToggle,
  onRemove,
}: {
  connection: Connection | null
  valid: boolean
  saving: boolean
  switching: boolean
  removing: boolean
  onSave: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  return (
    <DialogFooter>
      {connection ? (
        <>
          <Button variant="danger" onClick={onRemove} disabled={removing}>
            {t('features.pipelineConnections.settings.remove')}
          </Button>
          <Button onClick={onToggle} disabled={switching}>
            {connection.status === 'active'
              ? t('features.pipelineConnections.settings.switchOff')
              : t('features.pipelineConnections.settings.switchOn')}
          </Button>
        </>
      ) : null}
      <DialogClose render={<Button />}>
        {t('common.actions.cancel')}
      </DialogClose>
      <Button variant="primary" disabled={!valid || saving} onClick={onSave}>
        {connection
          ? t('features.pipelineConnections.settings.save')
          : t('features.pipelineConnections.settings.addAction')}
      </Button>
    </DialogFooter>
  )
}

function RemoveConfirm({
  open,
  name,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  name: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog open={open} onOpenChange={onOpenChange}>
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('features.pipelineConnections.settings.removeTitle', { name })}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t('features.pipelineConnections.settings.removeBody')}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>
            {t('common.actions.cancel')}
          </ConfirmDialogCancel>
          <ConfirmDialogAction
            variant="danger-fill"
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
          >
            {t('features.pipelineConnections.settings.remove')}
          </ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}

/** The names of a connection's secrets, with a way to set, rotate or delete one. A value is never shown. */
function SecretsEditor({
  workspaceId,
  connection,
  onChanged,
  onError,
}: {
  workspaceId: string
  connection: Connection
  onChanged: () => void
  onError: (message: string | null) => void
}) {
  const [secretName, setSecretName] = useState('')
  const [value, setValue] = useState('')

  const set = useMutation({
    mutationFn: () =>
      setPipelineConnectionSecretFn({
        data: {
          workspaceId,
          connectionId: connection.id,
          secretName,
          value,
        },
      }),
    onSuccess: () => {
      onError(null)
      setValue('')
      setSecretName('')
      onChanged()
    },
    onError: (cause) => onError(message(cause)),
  })

  const drop = useMutation({
    mutationFn: (name: string) =>
      deletePipelineConnectionSecretFn({
        data: { workspaceId, connectionId: connection.id, secretName: name },
      }),
    onSuccess: onChanged,
    onError: (cause) => onError(message(cause)),
  })

  const known = connection.secret_names.includes(secretName)

  return (
    <div className="flex flex-col gap-2">
      <h3 className="m-0 text-label font-semibold">
        {t('features.pipelineConnections.settings.secrets')}
      </h3>
      <Muted>
        {connection.kind === 'hpc'
          ? t('features.pipelineConnections.settings.secretsHintHpc')
          : t('features.pipelineConnections.settings.secretsHint')}
      </Muted>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {connection.secret_names.map((name) => (
          <div
            key={name}
            className="flex items-center justify-between gap-2 px-3 py-2"
          >
            <span className="flex items-center gap-2 mono text-label">
              <Icon name="key" size={14} />
              {name}
              <span className="text-fg-muted">
                {t('features.pipelineConnections.settings.valueHidden')}
              </span>
            </span>
            <Button
              size="sm"
              variant="quiet"
              aria-label={t(
                'features.pipelineConnections.settings.deleteSecret',
                {
                  name,
                },
              )}
              disabled={drop.isPending}
              onClick={() => drop.mutate(name)}
            >
              <Icon name="x" size={14} />
            </Button>
          </div>
        ))}
        {connection.secret_names.length === 0 ? (
          <p className="m-0 px-3 py-2 text-label text-fg-muted">
            {t('features.pipelineConnections.settings.noSecrets')}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label={t('features.pipelineConnections.settings.secretName')}>
          <Input
            value={secretName}
            placeholder={
              connection.kind === 'hpc'
                ? 'HPC_SUBMIT_KEY'
                : t('features.pipelineConnections.settings.secretPlaceholder')
            }
            onChange={(event) => setSecretName(event.target.value)}
          />
        </Field>
        <Field label={t('features.pipelineConnections.settings.secretValue')}>
          <Input
            type="password"
            autoComplete="off"
            value={value}
            placeholder="••••••••"
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Button
          disabled={
            !REMOTE_SECRET_RE.test(secretName) || !value.trim() || set.isPending
          }
          onClick={() => set.mutate()}
        >
          {known
            ? t('features.pipelineConnections.settings.rotate')
            : t('features.pipelineConnections.settings.set')}
        </Button>
      </div>
    </div>
  )
}
