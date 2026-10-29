import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted, Section } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import { Textarea } from '#/components/v3/inventory/list'
import { RegistryGrid } from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  assignProtocolTraining,
  fetchProtocolTrainingStatus,
  protocolTrainingKey,
  recordProtocolTrained,
  unassignProtocolTraining,
} from '#/lib/controlled-protocols'
import type { ProtocolTrainingStatus } from '#/lib/controlled-protocols'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

const STATUS: Record<
  ProtocolTrainingStatus['status'],
  { tone: 'ok' | 'warn' | 'none'; label: string }
> = {
  trained: {
    tone: 'ok',
    label: t('library.protocols.trainingRoster.statusTrained'),
  },
  required: {
    tone: 'warn',
    label: t('library.protocols.trainingRoster.statusRequired'),
  },
  out_of_date: {
    tone: 'warn',
    label: t('library.protocols.trainingRoster.statusOutOfDate'),
  },
  no_effective_version: {
    tone: 'none',
    label: t('library.protocols.trainingRoster.statusNoVersion'),
  },
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : t('library.protocols.trainingRoster.failed')
}

/**
 * Who is expected to keep up with the protocol and where each person stands.
 * Standing is read from the acknowledgements, the same fact that decides
 * whether an experiment may start, so this table can never disagree with it.
 */
export function ProtocolTrainingRoster({
  protocolId,
  members,
  writer,
}: {
  protocolId: string
  members: { user_id: string; name: string }[]
  writer: boolean
}) {
  const queryClient = useQueryClient()
  const [assignOpen, setAssignOpen] = useState(false)
  const [recording, setRecording] = useState<ProtocolTrainingStatus | null>(
    null,
  )
  const status = useQuery({
    queryKey: protocolTrainingKey(protocolId),
    queryFn: () => fetchProtocolTrainingStatus(notebookDataClient, protocolId),
  })
  const rows = status.data ?? []
  const names = useUserNames(
    rows.flatMap((r) =>
      r.recorded_by_user_id ? [r.user_id, r.recorded_by_user_id] : [r.user_id],
    ),
  )
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: protocolTrainingKey(protocolId),
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-acknowledgements'],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ui-port', 'protocol-inspector'],
    })
  }
  const remove = useMutation({
    mutationFn: (userId: string) =>
      unassignProtocolTraining(notebookDataClient, {
        protocolRecordId: protocolId,
        userId,
      }),
    onSuccess: () => {
      toast(t('library.protocols.trainingRoster.removed'))
      refresh()
    },
    onError: (error: unknown) => toast.error(errorText(error)),
  })

  const columns: RegistryColumn<ProtocolTrainingStatus>[] = [
    {
      id: 'person',
      header: t('library.protocols.trainingRoster.person'),
      cell: ({ row }) => names.userLabel(row.original.user_id),
    },
    {
      id: 'status',
      header: t('library.protocols.trainingRoster.status'),
      cell: ({ row }) => {
        const s = STATUS[row.original.status]
        return (
          <span className="flex items-center gap-2">
            <Status tone={s.tone}>{s.label}</Status>
            {row.original.overdue ? (
              <Status tone="bad">
                {t('library.protocols.trainingRoster.overdue')}
              </Status>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'trainedOn',
      header: t('library.protocols.trainingRoster.trainedOn'),
      cell: ({ row }) =>
        row.original.trained_version !== null
          ? `${t('library.protocols.trainingRoster.version', { version: row.original.trained_version })} · ${formatDate(row.original.trained_at ?? '')}`
          : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'due',
      header: t('library.protocols.trainingRoster.due'),
      cell: ({ row }) =>
        row.original.due_at ? formatDate(row.original.due_at) : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    {
      id: 'trainer',
      header: t('library.protocols.trainingRoster.trainer'),
      cell: ({ row }) =>
        row.original.recorded_by_user_id &&
        row.original.recorded_by_user_id !== row.original.user_id
          ? names.userLabel(row.original.recorded_by_user_id)
          : row.original.trained_version !== null
            ? t('library.protocols.trainingRoster.self')
            : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
    ...(writer
      ? [
          {
            id: 'actions',
            header: '',
            enableHiding: false,
            cell: ({ row }) => (
              <span className="flex justify-end gap-1">
                {row.original.status !== 'trained' &&
                row.original.current_version_id ? (
                  <Button size="sm" onClick={() => setRecording(row.original)}>
                    {t('library.protocols.trainingRoster.recordTrained')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(row.original.user_id)}
                >
                  {t('library.protocols.trainingRoster.remove')}
                </Button>
              </span>
            ),
          } satisfies RegistryColumn<ProtocolTrainingStatus>,
        ]
      : []),
  ]

  return (
    <Section
      title={t('library.protocols.trainingRoster.title')}
      action={
        writer ? (
          <Button icon="plus" onClick={() => setAssignOpen(true)}>
            {t('library.protocols.trainingRoster.assign')}
          </Button>
        ) : null
      }
    >
      <Muted>{t('library.protocols.trainingRoster.body')}</Muted>
      {!status.isPending && rows.length === 0 ? (
        <EmptyState
          icon="user"
          className="items-center py-8 text-center"
          title={t('library.protocols.trainingRoster.none')}
          description={t('library.protocols.trainingRoster.noneBody')}
        />
      ) : (
        <TableBox>
          <RegistryGrid
            label={t('library.protocols.trainingRoster.label')}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.user_id}
            selectable={false}
            isLoading={status.isPending}
          />
        </TableBox>
      )}
      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        protocolId={protocolId}
        members={members}
        onDone={refresh}
      />
      {recording ? (
        <RecordDialog
          row={recording}
          name={names.userLabel(recording.user_id)}
          onClose={() => setRecording(null)}
          onDone={refresh}
        />
      ) : null}
    </Section>
  )
}

function AssignDialog({
  open,
  onOpenChange,
  protocolId,
  members,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  protocolId: string
  members: { user_id: string; name: string }[]
  onDone: () => void
}) {
  const [userId, setUserId] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [notes, setNotes] = useState('')
  const assign = useMutation({
    mutationFn: () =>
      assignProtocolTraining(notebookDataClient, {
        protocolRecordId: protocolId,
        userId,
        dueAt: dueOn ? new Date(`${dueOn}T23:59:59`).toISOString() : null,
        notes,
      }),
    onSuccess: () => {
      toast(t('library.protocols.trainingRoster.assigned'))
      setUserId('')
      setDueOn('')
      setNotes('')
      onOpenChange(false)
      onDone()
    },
    onError: (error: unknown) => toast.error(errorText(error)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.protocols.trainingRoster.dialogTitle')}
          description={t('library.protocols.trainingRoster.dialogBody')}
        />
        <DialogBody>
          <Field
            label={t('library.protocols.trainingRoster.personField')}
            required
          >
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">
                {t('library.protocols.trainingRoster.personPlaceholder')}
              </option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('library.protocols.trainingRoster.dueField')}
            hint={t('library.protocols.trainingRoster.dueHint')}
          >
            <Input
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </Field>
          <Field
            label={t('library.protocols.trainingRoster.notesField')}
            hint={t('library.protocols.trainingRoster.notesHint')}
          >
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!userId || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {assign.isPending
              ? t('library.protocols.trainingRoster.saving')
              : t('library.protocols.trainingRoster.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordDialog({
  row,
  name,
  onClose,
  onDone,
}: {
  row: ProtocolTrainingStatus
  name: string
  onClose: () => void
  onDone: () => void
}) {
  const [notes, setNotes] = useState('')
  const record = useMutation({
    mutationFn: () =>
      recordProtocolTrained(notebookDataClient, {
        versionId: row.current_version_id ?? '',
        userId: row.user_id,
        notes,
      }),
    onSuccess: () => {
      toast(t('library.protocols.trainingRoster.recorded'))
      onClose()
      onDone()
    },
    onError: (error: unknown) => toast.error(errorText(error)),
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="w-[min(480px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.protocols.trainingRoster.recordTitle', { name })}
          description={t('library.protocols.trainingRoster.recordBody', {
            version: row.current_version ?? '',
          })}
        />
        <DialogBody>
          <Field label={t('library.protocols.trainingRoster.recordNotes')}>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={record.isPending}
            onClick={() => record.mutate()}
          >
            {t('library.protocols.trainingRoster.recordSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
