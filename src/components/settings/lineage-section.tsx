import { useState } from 'react'
import { LoadingBlock } from '#/components/ui/page-skeleton'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { ConfirmPrompt } from '#/components/ui/confirm-prompt'
import { Notice } from '#/components/ui/alert'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldRow, Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { Status } from '#/components/ui/status'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { formatDate } from '#/lib/format-date'
import { describeAdminError } from '#/lib/workspace-admin'
import {
  deleteLineageTargetFn,
  lineageAdminKeys,
  listLineageSettingsFn,
  retryLineageDeliveriesFn,
  saveLineageTargetFn,
  setEventStreamRetentionFn,
  testLineageTargetFn,
} from '#/lib/provenance/lineage-admin'
import type { LineageTargetWire } from '#/lib/provenance/lineage-admin'
import { t } from '#/copy'

function useRefreshLineage(workspaceId: string) {
  const queryClient = useQueryClient()

  return () =>
    queryClient.invalidateQueries({
      queryKey: lineageAdminKeys.settings(workspaceId),
    })
}

/** Where lineage events go, and how long the event stream keeps its history. */
export function LineageSection({
  workspaceId,
  canManage,
  dataAccess = false,
}: {
  workspaceId: string
  canManage: boolean
  /** Stewards see where the stream is read from. */
  dataAccess?: boolean
}) {
  const settings = useQuery({
    queryKey: lineageAdminKeys.settings(workspaceId),
    queryFn: () => listLineageSettingsFn({ data: { workspaceId } }),
  })

  const refresh = useRefreshLineage(workspaceId)
  const [editing, setEditing] = useState<LineageTargetWire | 'new' | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  )

  const test = useMutation({
    mutationFn: (id: string) =>
      testLineageTargetFn({ data: { workspaceId, id } }),
    onSuccess: async (result) => {
      setNotice({
        ok: result.ok,
        text: `${result.ok ? t('settings.lineage.testOk') : t('settings.lineage.testFailed')}: ${result.message}`,
      })
      await refresh()
    },
  })

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- onSuccess awaits refresh(), whose useRefreshLineage helper invalidates lineageAdminKeys.settings(workspaceId).
  const retry = useMutation({
    mutationFn: (id: string) =>
      retryLineageDeliveriesFn({ data: { workspaceId, id } }),
    onSuccess: async (result) => {
      setNotice({
        ok: true,
        text: t('settings.lineage.retried', { count: result.requeued }),
      })
      await refresh()
    },
  })

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- onSuccess is refresh(), whose useRefreshLineage helper invalidates lineageAdminKeys.settings(workspaceId).
  const remove = useMutation({
    mutationFn: (id: string) =>
      deleteLineageTargetFn({ data: { workspaceId, id } }),
    onSuccess: refresh,
  })

  const columns: RegistryColumn<LineageTargetWire>[] = [
    {
      id: 'name',
      size: 280,
      header: t('settings.lineage.name'),
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{row.original.name}</span>
          <span className="truncate text-label text-fg-muted">
            {row.original.endpointUrl}
          </span>
        </span>
      ),
    },
    {
      id: 'sending',
      size: 110,
      header: t('settings.lineage.sending'),
      cell: ({ row }) => (
        <Status tone={row.original.enabled ? 'ok' : 'stored'}>
          {row.original.enabled
            ? t('settings.lineage.sendingOn')
            : t('settings.lineage.sendingOff')}
        </Status>
      ),
    },
    {
      id: 'status',
      size: 150,
      header: t('settings.lineage.status'),
      cell: ({ row }) => <LineageDeliveryStatus target={row.original} />,
    },
    {
      id: 'test',
      size: 230,
      header: t('settings.lineage.lastTest'),
      cell: ({ row }) => <LineageLastTest target={row.original} />,
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            size: 260,
            header: '',
            cell: ({ row }) => (
              <span className="flex flex-nowrap justify-end gap-1">
                <Button
                  size="sm"
                  disabled={test.isPending}
                  onClick={() => test.mutate(row.original.id)}
                >
                  {test.isPending && test.variables === row.original.id
                    ? t('settings.lineage.testing')
                    : t('settings.lineage.test')}
                </Button>
                {row.original.failed > 0 ? (
                  <Button
                    size="sm"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(row.original.id)}
                  >
                    {t('settings.lineage.retry')}
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => setEditing(row.original)}>
                  {t('settings.lineage.edit')}
                </Button>
              </span>
            ),
          } satisfies RegistryColumn<LineageTargetWire>,
        ]
      : []),
  ]

  const targets = settings.data?.targets ?? []

  return (
    <>
      <Section
        title={t('settings.lineage.title')}
        description={t('settings.lineage.description')}
        action={
          canManage ? (
            <Button icon="plus" size="sm" onClick={() => setEditing('new')}>
              {t('settings.lineage.add')}
            </Button>
          ) : undefined
        }
      >
        {notice ? (
          <Notice tone={notice.ok ? 'info' : 'bad'}>{notice.text}</Notice>
        ) : null}
        <LineageTargets
          targets={targets}
          columns={columns}
          failed={settings.isError}
          loading={settings.isLoading}
        />
      </Section>
      {settings.data ? (
        <RetentionField
          workspaceId={workspaceId}
          days={settings.data.retentionDays}
          canManage={canManage}
          dataAccess={dataAccess}
          onSaved={refresh}
        />
      ) : null}
      {editing ? (
        <TargetDialog
          workspaceId={workspaceId}
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onRemove={
            editing !== 'new' ? () => setRemoving(editing.id) : undefined
          }
        />
      ) : null}
      {removing ? (
        <ConfirmPrompt
          message={t('settings.lineage.removeConfirm')}
          confirmLabel={t('settings.lineage.remove')}
          variant="danger-fill"
          onConfirm={() => {
            remove.mutate(removing)
            setEditing(null)
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  )
}

function LineageTargets({
  targets,
  columns,
  failed,
  loading,
}: {
  targets: LineageTargetWire[]
  columns: RegistryColumn<LineageTargetWire>[]
  failed: boolean
  loading: boolean
}) {
  if (failed)
    return (
      <p role="alert" className="m-0 text-label text-danger-text">
        {t('settings.lineage.loadFailed')}
      </p>
    )

  if (targets.length)
    return (
      <TableBox role="region" aria-label={t('settings.lineage.tableLabel')}>
        <RegistryGrid
          label={t('settings.lineage.tableLabel')}
          rows={targets}
          columns={columns}
          getRowId={(target) => target.id}
          selectable={false}
        />
      </TableBox>
    )

  if (loading) {
    return <LoadingBlock label={t('settings.lineage.loading')} />
  }

  return <Muted>{t('settings.lineage.empty')}</Muted>
}

function LineageDeliveryStatus({ target }: { target: LineageTargetWire }) {
  if (target.failed > 0)
    return (
      <Status tone="bad">
        {t('settings.lineage.failedCount', { count: target.failed })}
      </Status>
    )

  if (target.pending > 0)
    return (
      <Status tone="warn">
        {t('settings.lineage.waiting', { count: target.pending })}
      </Status>
    )

  return <Status tone="ok">{t('settings.lineage.allSent')}</Status>
}

function LineageLastTest({ target }: { target: LineageTargetWire }) {
  if (target.lastTestOk == null || !target.lastTestAt)
    return <Muted>{t('settings.lineage.testNever')}</Muted>

  return (
    <span title={target.lastTestMessage ?? undefined}>
      <Status tone={target.lastTestOk ? 'ok' : 'bad'}>
        {target.lastTestOk
          ? t('settings.lineage.testOk')
          : t('settings.lineage.testFailed')}
      </Status>{' '}
      <span className="text-label text-fg-muted">
        {formatDate(target.lastTestAt, { time: true })}
      </span>
    </span>
  )
}

function RetentionField({
  workspaceId,
  days,
  canManage,
  dataAccess,
  onSaved,
}: {
  workspaceId: string
  days: number
  canManage: boolean
  dataAccess: boolean
  onSaved: () => Promise<void>
}) {
  const [value, setValue] = useState(String(days))

  const save = useMutation({
    mutationFn: () =>
      setEventStreamRetentionFn({
        data: { workspaceId, days: Number(value) },
      }),
    onSuccess: onSaved,
  })

  const valid =
    Number.isInteger(Number(value)) &&
    Number(value) >= 1 &&
    Number(value) <= 3650

  return (
    <Section
      title={t('settings.lineage.streamTitle')}
      description={t('settings.lineage.streamDescription')}
    >
      {dataAccess ? (
        <Muted>
          {t('settings.lineage.streamAddress', { path: '/api/events/stream' })}
        </Muted>
      ) : null}
      <FieldRow>
        <Field label={t('settings.lineage.streamDays')} className="w-28">
          <Input
            type="number"
            min={1}
            max={3650}
            value={value}
            disabled={!canManage}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        {canManage ? (
          <Button
            disabled={!valid || save.isPending || Number(value) === days}
            onClick={() => save.mutate()}
          >
            {t('settings.lineage.streamSave')}
          </Button>
        ) : null}
      </FieldRow>
      {save.isError ? (
        <Notice tone="bad">{describeAdminError(save.error)}</Notice>
      ) : null}
    </Section>
  )
}

function TargetDialog({
  workspaceId,
  target,
  onClose,
  onSaved,
  onRemove,
}: {
  workspaceId: string
  target: LineageTargetWire | null
  onClose: () => void
  onSaved: () => Promise<void>
  onRemove?: () => void
}) {
  const [name, setName] = useState(target?.name ?? '')
  const [url, setUrl] = useState(target?.endpointUrl ?? '')
  const [namespace, setNamespace] = useState(target?.namespace ?? 'sheetbase')

  const [headerName, setHeaderName] = useState(
    target?.authHeaderName ?? 'Authorization',
  )

  const [headerValue, setHeaderValue] = useState('')
  const [enabled, setEnabled] = useState(target?.enabled ?? false)

  const save = useMutation({
    mutationFn: () =>
      saveLineageTargetFn({
        data: {
          workspaceId,
          id: target?.id ?? null,
          name,
          endpointUrl: url,
          namespace,
          authHeaderName: headerName,
          headerValue,
          enabled,
        },
      }),
    onSuccess: async () => {
      await onSaved()
      onClose()
    },
  })

  const ready = name.trim().length > 0 && /^https?:\/\/\S+$/.test(url.trim())

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader
          title={
            target ? t('settings.lineage.edit') : t('settings.lineage.add')
          }
          description={t('settings.lineage.description')}
        />
        <DialogBody>
          <Field
            label={t('settings.lineage.name')}
            hint={t('settings.lineage.nameHint')}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label={t('settings.lineage.url')}
            hint={t('settings.lineage.urlHint')}
          >
            <Input value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field
            label={t('settings.lineage.namespace')}
            hint={t('settings.lineage.namespaceHint')}
          >
            <Input
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
            />
          </Field>
          <Field label={t('settings.lineage.headerName')}>
            <Input
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
            />
          </Field>
          <Field
            label={t('settings.lineage.headerValue')}
            hint={
              target?.hasSecret
                ? t('settings.lineage.headerValueKept')
                : t('settings.lineage.headerValueHint')
            }
          >
            <Input
              type="password"
              autoComplete="off"
              value={headerValue}
              onChange={(e) => setHeaderValue(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-body">
            <Checkbox
              checked={enabled}
              onCheckedChange={(on) => setEnabled(Boolean(on))}
            />
            {t('settings.lineage.sendingToggle')}
          </label>
          <Muted>{t('settings.lineage.sendingToggleHint')}</Muted>
          {save.isError ? (
            <Notice tone="bad">{describeAdminError(save.error)}</Notice>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {onRemove ? (
            <Button variant="danger" onClick={onRemove}>
              {t('settings.lineage.remove')}
            </Button>
          ) : null}
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('settings.lineage.saving')
              : t('settings.lineage.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
