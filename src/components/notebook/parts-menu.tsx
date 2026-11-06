import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { IconButton } from '#/components/ui/icon-button'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import {
  createExperimentPart,
  deleteExperimentPart,
  moveExperimentPart,
  partQueryKeys,
  setPartDone,
  splitPointsAtHeadings,
  splitRecordIntoParts,
  updateExperimentPart,
} from '#/lib/experiment-parts'
import type { PartProgress, SplitPoint } from '#/lib/experiment-parts'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { adminQueryKeys, fetchWorkspaceMembers } from '#/lib/workspace-admin'

/** Refresh everything a change to the parts touches. */
function useRefreshParts(recordId: string) {
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: partQueryKeys.forRecord(recordId),
      }),
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.blocks(recordId),
      }),
      queryClient.invalidateQueries({
        queryKey: notebookQueryKeys.record(recordId),
      }),
    ])
  }, [queryClient, recordId])
}

type Editing =
  | { kind: 'add' }
  | { kind: 'edit'; part: PartProgress }
  | { kind: 'delete'; part: PartProgress }
  | null

/**
 * Adding and changing parts: one menu, shown to whoever can edit the notebook.
 * Everything here is one database call, so the strip, the outline, the
 * assistant and the API all change parts the same way.
 */
export function PartsMenu({
  recordId,
  expId,
  parts,
  shown,
  workspaceId,
}: {
  recordId: string
  expId: string
  parts: readonly PartProgress[]
  shown: PartProgress
  workspaceId?: string
}) {
  const [editing, setEditing] = React.useState<Editing>(null)
  const refresh = useRefreshParts(recordId)
  const navigate = useNavigate()
  const move = useMutation({
    mutationFn: (afterPartId: string | null) =>
      moveExperimentPart(notebookDataClient, shown.id, afterPartId),
    onSuccess: refresh,
    onError: () => toast.error(t('notebook.parts.couldNotChange')),
  })
  const done = useMutation({
    mutationFn: (value: boolean) =>
      setPartDone(notebookDataClient, shown.id, value),
    onSuccess: async (_row, value) => {
      await refresh()
      toast.success(
        t(value ? 'notebook.parts.partDone' : 'notebook.parts.partReopened', {
          number: String(shown.number),
        }),
      )
    },
    onError: () => toast.error(t('notebook.parts.couldNotChange')),
  })
  const index = parts.findIndex((part) => part.id === shown.id)
  const before = index > 0 ? parts[index - 1] : null
  const beforeThat = index > 1 ? parts[index - 2] : null
  const after = index < parts.length - 1 ? parts[index + 1] : null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              label={t('notebook.parts.renamePart')}
              icon="more"
              data-testid="parts-menu"
            />
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            icon="plus"
            onClick={() => setEditing({ kind: 'add' })}
          >
            {t('notebook.parts.addPart')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon="edit"
            onClick={() => setEditing({ kind: 'edit', part: shown })}
          >
            {t('notebook.parts.renamePart')}
          </DropdownMenuItem>
          {shown.stepCount === 0 ? (
            <DropdownMenuItem
              icon="check"
              disabled={done.isPending}
              onClick={() => done.mutate(shown.state !== 'done')}
            >
              {shown.state === 'done'
                ? t('notebook.parts.reopenPart')
                : t('notebook.parts.markPartDone')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon="arrowUp"
            disabled={!before || move.isPending}
            onClick={() => move.mutate(beforeThat ? beforeThat.id : null)}
          >
            {t('notebook.parts.moveEarlier')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon="arrowDown"
            disabled={!after || move.isPending}
            onClick={() => after && move.mutate(after.id)}
          >
            {t('notebook.parts.moveLater')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            icon="x"
            danger
            onClick={() => setEditing({ kind: 'delete', part: shown })}
          >
            {t('notebook.parts.deletePart')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing?.kind === 'add' ? (
        <PartFormDialog
          recordId={recordId}
          workspaceId={workspaceId}
          after={parts[parts.length - 1] ?? null}
          onClose={() => setEditing(null)}
          onSaved={async (created) => {
            await refresh()
            const number = parts.length + 1
            if (created) {
              void navigate({
                to: '/experiments/$expId/notebook/$part',
                params: { expId, part: String(number) },
              })
            }
          }}
        />
      ) : null}
      {editing?.kind === 'edit' ? (
        <PartFormDialog
          recordId={recordId}
          workspaceId={workspaceId}
          part={editing.part}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}
      {editing?.kind === 'delete' ? (
        <DeletePartDialog
          recordId={recordId}
          part={editing.part}
          parts={parts}
          onClose={() => setEditing(null)}
          onDeleted={async () => {
            await refresh()
            void navigate({
              to: '/experiments/$expId/notebook',
              params: { expId },
            })
          }}
        />
      ) : null}
    </>
  )
}

/** Add a part, or rename, reschedule and reassign one. */
export function PartFormDialog({
  recordId,
  workspaceId,
  part,
  after = null,
  onClose,
  onSaved,
}: {
  recordId: string
  workspaceId?: string
  /** The part being changed; absent when adding. */
  part?: PartProgress
  /** The part a new one goes after. */
  after?: PartProgress | null
  onClose: () => void
  onSaved: (created: boolean) => void | Promise<void>
}) {
  const adding = !part
  const [title, setTitle] = React.useState(part?.title ?? '')
  const [day, setDay] = React.useState(
    String(part?.dayOffset ?? (after ? after.dayOffset + 1 : 0)),
  )
  const [assignee, setAssignee] = React.useState(part?.assigneeUserId ?? '')
  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId ?? 'none'),
    queryFn: () => fetchWorkspaceMembers(notebookDataClient, workspaceId!),
    enabled: Boolean(workspaceId),
  })
  const people = (members.data ?? []).filter(
    (member) => member.suspendedAt === null,
  )
  const { userLabel } = useUserNames(people.map((member) => member.userId))
  const dayNumber = Number(day)
  const ready =
    title.trim() !== '' &&
    /^[0-9]{1,4}$/.test(day) &&
    dayNumber >= 0 &&
    dayNumber <= 3650
  const save = useMutation({
    mutationFn: async () => {
      if (adding) {
        return createExperimentPart(notebookDataClient, {
          recordId,
          title: title.trim(),
          dayOffset: dayNumber,
          afterPartId: after?.id ?? null,
        })
      }
      return updateExperimentPart(notebookDataClient, {
        partId: part.id,
        title: title.trim(),
        dayOffset: dayNumber,
        assigneeUserId: assignee === '' ? null : assignee,
      })
    },
    onSuccess: async (row) => {
      // A new part can be given a person straight away.
      if (adding && assignee !== '') {
        await updateExperimentPart(notebookDataClient, {
          partId: row.id,
          assigneeUserId: assignee,
        })
      }
      await onSaved(adding)
      toast.success(t(adding ? 'notebook.parts.added' : 'notebook.parts.saved'))
      onClose()
    },
    onError: () => toast.error(t('notebook.parts.couldNotSave')),
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={
            adding
              ? t('notebook.parts.addPartTitle')
              : t('notebook.parts.editTitle', { number: String(part.number) })
          }
          description={adding ? t('notebook.parts.addPartHint') : undefined}
        />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready && !save.isPending) save.mutate()
          }}
        >
          <DialogBody>
            <Field label={t('notebook.parts.titleLabel')} required>
              <Input
                autoFocus
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field
              label={t('notebook.parts.dayLabel')}
              hint={t('notebook.parts.dayHint')}
              required
            >
              <Input
                inputMode="numeric"
                value={day}
                maxLength={4}
                className="w-24"
                onChange={(event) => setDay(event.target.value)}
              />
            </Field>
            <Field label={t('notebook.parts.assigneeLabel')}>
              <Select
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">{t('notebook.parts.assigneeNobody')}</option>
                {people.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {userLabel(member.userId)}
                  </option>
                ))}
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!ready || save.isPending}
            >
              {save.isPending
                ? t('notebook.parts.saving')
                : adding
                  ? t('notebook.parts.add')
                  : t('notebook.parts.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeletePartDialog({
  recordId,
  part,
  parts,
  onClose,
  onDeleted,
}: {
  recordId: string
  part: PartProgress
  parts: readonly PartProgress[]
  onClose: () => void
  onDeleted: () => void | Promise<void>
}) {
  const others = parts.filter((other) => other.id !== part.id)
  const empty = part.blockCount === 0
  const fallbackId =
    others.find((other) => other.number === part.number - 1)?.id ??
    others.at(0)?.id ??
    ''
  const [target, setTarget] = React.useState(fallbackId)
  const remove = useMutation({
    mutationFn: () =>
      deleteExperimentPart(
        notebookDataClient,
        part.id,
        empty ? null : target || null,
      ),
    onSuccess: async () => {
      await onDeleted()
      toast.success(t('notebook.parts.deleted'))
      onClose()
    },
    onError: () => toast.error(t('notebook.parts.couldNotChange')),
  })
  void recordId
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={t('notebook.parts.deleteTitle', {
            number: String(part.number),
          })}
          description={
            empty
              ? t('notebook.parts.deleteEmpty')
              : t('notebook.parts.deleteWithContent')
          }
        />
        <DialogBody>
          {empty || others.length === 0 ? null : (
            <Field label={t('notebook.parts.moveContentTo')}>
              <Select
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {others.map((other) => (
                  <option key={other.id} value={other.id}>
                    {t('notebook.parts.partTitle', {
                      number: String(other.number),
                      title: other.title,
                    })}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending || (!empty && target === '')}
            onClick={() => remove.mutate()}
          >
            {t('notebook.parts.deletePart')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Split an experiment that has no parts: one part for each section that starts
 * with a heading (or one part holding everything, to add the rest by hand).
 */
export function SplitIntoPartsDialog({
  recordId,
  points,
  onClose,
}: {
  recordId: string
  points: readonly SplitPoint[]
  onClose: () => void
}) {
  const refresh = useRefreshParts(recordId)
  const split = useMutation({
    mutationFn: () =>
      splitRecordIntoParts(notebookDataClient, recordId, points),
    onSuccess: async () => {
      await refresh()
      toast.success(t('notebook.parts.splitDone'))
      onClose()
    },
    onError: () => toast.error(t('notebook.parts.couldNotChange')),
  })
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader
          title={t('notebook.parts.splitTitle')}
          description={
            points.length > 0
              ? t('notebook.parts.splitBody', { count: points.length })
              : t('notebook.parts.splitNone')
          }
        />
        <DialogBody>
          <ol className="m-0 flex list-none flex-col gap-1 p-0 text-body text-fg">
            {points.map((point, index) => (
              <li key={point.firstBlockId}>
                {t('notebook.parts.partTitle', {
                  number: String(index + 1),
                  title: point.title,
                })}
              </li>
            ))}
          </ol>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={split.isPending || points.length === 0}
            onClick={() => split.mutate()}
          >
            {split.isPending
              ? t('notebook.parts.working')
              : t('notebook.parts.splitConfirm', { count: points.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * For an experiment with no parts: the way to split it. Each section that
 * starts with a heading becomes a part; with no headings it starts with one part
 * that holds everything, and the rest are added from there.
 */
export function SplitIntoPartsAction({
  recordId,
  expId,
  blocks,
}: {
  recordId: string
  expId: string
  blocks: ReadonlyArray<{
    id: string
    type: string
    order: number
    payload: Record<string, unknown>
  }>
}) {
  const [open, setOpen] = React.useState(false)
  const refresh = useRefreshParts(recordId)
  const navigate = useNavigate()
  const points = React.useMemo(() => splitPointsAtHeadings(blocks), [blocks])
  const start = useMutation({
    mutationFn: () =>
      createExperimentPart(notebookDataClient, {
        recordId,
        title: t('notebook.parts.firstPartTitle'),
        dayOffset: 0,
      }),
    onSuccess: async () => {
      await refresh()
      void navigate({
        to: '/experiments/$expId/notebook/$part',
        params: { expId, part: '1' },
      })
    },
    onError: () => toast.error(t('notebook.parts.couldNotChange')),
  })
  return (
    <div className="flex flex-col gap-2" data-testid="split-into-parts">
      <p className="m-0 text-label text-fg-muted">
        {t('notebook.parts.splitHint')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={points.length < 2}
          onClick={() => setOpen(true)}
        >
          {t('notebook.parts.split')}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {t('notebook.parts.startParts')}
        </Button>
      </div>
      {open ? (
        <SplitIntoPartsDialog
          recordId={recordId}
          points={points}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}
