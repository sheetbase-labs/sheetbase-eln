import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { projectOption } from '#/components/v3/record-picker/entity-options'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { Field, Input } from '#/components/v3/ui/input'
import { toast } from '#/components/v3/ui/sonner'
import { Icon } from '#/components/v3/icons'
import { SaveAsTemplateDialog } from '#/components/v3/experiments/save-as-template-dialog'
import {
  archiveExperiment,
  createNewRun,
  deleteExperimentDraft,
  moveExperimentToProject,
  setExperimentStatus,
  startExperimentRecord,
} from '#/lib/experiment-lifecycle'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import { experimentQueryKeys } from '../$expId'
import type { useExperimentRecord } from '../$expId'
import { t } from '#/copy'

type ExperimentRow = NonNullable<ReturnType<typeof useExperimentRecord>['data']>

type DialogKind =
  'hold' | 'move' | 'run' | 'template' | 'archive' | 'delete' | null

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : t('projects.lifecycle.failed')
}

/**
 * The experiment's lifecycle in its header: the one next step as a button
 * (Start, Put on hold, Resume) and the rest in a menu (New run, Move,
 * Archive, Delete draft). Every transition is decided by the server, so a
 * refusal arrives as its message in a toast rather than a disabled control.
 */
export function ExperimentLifecycleActions({
  experiment: e,
}: {
  experiment: ExperimentRow
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [reason, setReason] = useState('')
  const [runTitle, setRunTitle] = useState(
    t('projects.lifecycle.runTitle', { title: e.title }),
  )
  const [moveTo, setMoveTo] = useState('')

  const projects = useQuery({
    queryKey: ['ui-port', 'experiment-move-projects'],
    queryFn: () =>
      notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&archived_at=is.null&order=title.asc',
      ),
    enabled: dialog === 'move',
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: experimentQueryKeys.record(e.id),
    })
    // The notebook reads the same record under its own key; a stale status
    // there would put the old lifecycle into the next submission.
    await queryClient.invalidateQueries({
      queryKey: notebookQueryKeys.record(e.id),
    })
    await queryClient.invalidateQueries({
      queryKey: ['ui-port', 'experiments'],
    })
  }
  const close = () => {
    setDialog(null)
    setReason('')
  }

  const start = useMutation({
    mutationFn: () =>
      startExperimentRecord(notebookDataClient, { recordId: e.id }),
    onSuccess: async () => {
      await refresh()
      toast(t('projects.lifecycle.started'))
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const hold = useMutation({
    mutationFn: (status: 'on_hold' | 'in_progress') =>
      setExperimentStatus(notebookDataClient, {
        recordId: e.id,
        status,
        reason:
          reason.trim() ||
          (status === 'on_hold'
            ? t('projects.lifecycle.holdReason')
            : t('projects.lifecycle.resumeReason')),
      }),
    onSuccess: async (_data, status) => {
      close()
      await refresh()
      toast(
        status === 'on_hold'
          ? t('projects.lifecycle.onHold')
          : t('projects.lifecycle.resumed'),
      )
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const run = useMutation({
    mutationFn: () =>
      createNewRun(notebookDataClient, {
        source: {
          id: e.id,
          projectId: e.project_id,
          identifier: e.identifier,
          title: e.title,
          tags: e.tags ?? [],
        },
        title: runTitle,
      }),
    onSuccess: async (record) => {
      close()
      toast(t('projects.lifecycle.created', { identifier: record.identifier }))
      await navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: record.id },
      })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const move = useMutation({
    mutationFn: () =>
      moveExperimentToProject(notebookDataClient, {
        recordId: e.id,
        projectId: moveTo,
      }),
    onSuccess: async () => {
      close()
      await refresh()
      toast(t('projects.lifecycle.moved'))
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const archive = useMutation({
    mutationFn: () => archiveExperiment(notebookDataClient, e.id),
    onSuccess: async () => {
      close()
      await refresh()
      toast(t('projects.lifecycle.archived'))
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const remove = useMutation({
    mutationFn: () => deleteExperimentDraft(notebookDataClient, e.id),
    onSuccess: async () => {
      close()
      await queryClient.invalidateQueries({
        queryKey: ['ui-port', 'experiments'],
      })
      toast(t('projects.lifecycle.deleted'))
      await navigate({ to: '/experiments' })
    },
    onError: (error) => toast.error(errorText(error)),
  })

  const archived = Boolean(e.archived_at)
  const isDraft = e.status === 'draft'
  const isActive = e.status === 'in_progress'
  const isHold = e.status === 'on_hold'
  if (archived) return null

  return (
    <>
      {isDraft ? (
        <Button
          variant="primary"
          icon="play"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {t('projects.lifecycle.start')}
        </Button>
      ) : null}
      {isActive ? (
        <Button icon="pause" onClick={() => setDialog('hold')}>
          {t('projects.lifecycle.putOnHold')}
        </Button>
      ) : null}
      {isHold ? (
        <Button
          icon="play"
          disabled={hold.isPending}
          onClick={() => hold.mutate('in_progress')}
        >
          {t('projects.lifecycle.resume')}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="quiet"
              size="icon"
              aria-label={t('projects.lifecycle.more')}
            >
              <Icon name="more" size={14} />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            icon="link"
            onClick={() =>
              void navigate({
                to: '/experiments/$expId/links',
                params: { expId: e.id },
              })
            }
          >
            {t('projects.lifecycle.links')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon="clock"
            onClick={() =>
              void navigate({
                to: '/experiments/$expId/revisions',
                params: { expId: e.id },
              })
            }
          >
            {t('projects.lifecycle.revisions')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {e.project_id ? (
            <DropdownMenuItem icon="copy" onClick={() => setDialog('run')}>
              {t('projects.lifecycle.newRun')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            icon="template"
            onClick={() => setDialog('template')}
          >
            {t('projects.saveAsTemplate.submit')}
          </DropdownMenuItem>
          {isDraft ? (
            <DropdownMenuItem icon="move" onClick={() => setDialog('move')}>
              {t('projects.lifecycle.moveItem')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon="archive" onClick={() => setDialog('archive')}>
            {t('projects.lifecycle.archive')}
          </DropdownMenuItem>
          {isDraft ? (
            <DropdownMenuItem danger onClick={() => setDialog('delete')}>
              {t('projects.lifecycle.deleteDraft')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'template' ? (
        <SaveAsTemplateDialog
          open
          onOpenChange={(open) => (open ? null : close())}
          experiment={e}
        />
      ) : null}

      <Dialog
        open={dialog === 'hold'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <DialogContent>
          <DialogHeader
            title={t('projects.lifecycle.holdDialog.title')}
            description={t('projects.lifecycle.holdDialog.body')}
          />
          <DialogBody>
            <Field label={t('projects.lifecycle.holdDialog.reason')} required>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('projects.lifecycle.holdDialog.placeholder')}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose
              render={<Button>{t('common.actions.cancel')}</Button>}
            />
            <Button
              variant="primary"
              disabled={!reason.trim() || hold.isPending}
              onClick={() => hold.mutate('on_hold')}
            >
              {t('projects.lifecycle.putOnHold')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'run'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <DialogContent>
          <DialogHeader
            title={t('projects.lifecycle.runDialog.title')}
            description={t('projects.lifecycle.runDialog.body')}
          />
          <DialogBody>
            <Field label={t('projects.lifecycle.runDialog.field')}>
              <Input
                value={runTitle}
                onChange={(event) => setRunTitle(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose
              render={<Button>{t('common.actions.cancel')}</Button>}
            />
            <Button
              variant="primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              {t('projects.lifecycle.runDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'move'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <DialogContent>
          <DialogHeader
            title={t('projects.lifecycle.moveDialog.title')}
            description={t('projects.lifecycle.moveDialog.body')}
          />
          <DialogBody>
            <Field label="Project">
              <PickerSelect
                noun="project"
                value={moveTo}
                onChange={(id) => setMoveTo(id)}
                options={(projects.data ?? [])
                  .filter((project) => project.id !== e.project_id)
                  .map((project) => projectOption(project))}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose
              render={<Button>{t('common.actions.cancel')}</Button>}
            />
            <Button
              variant="primary"
              disabled={!moveTo || move.isPending}
              onClick={() => move.mutate()}
            >
              {t('projects.lifecycle.moveDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'archive'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <DialogContent>
          <DialogHeader
            title={t('projects.lifecycle.archiveDialog.title', {
              identifier: e.identifier,
            })}
            description={t('projects.lifecycle.archiveDialog.body')}
          />
          <DialogFooter>
            <DialogClose
              render={<Button>{t('common.actions.cancel')}</Button>}
            />
            <Button
              variant="primary"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              {t('projects.lifecycle.archive')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'delete'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <DialogContent>
          <DialogHeader
            title={t('projects.lifecycle.deleteDialog.title', {
              identifier: e.identifier,
            })}
            description={t('projects.lifecycle.deleteDialog.body')}
          />
          <DialogFooter>
            <DialogClose
              render={<Button>{t('common.actions.cancel')}</Button>}
            />
            <Button
              variant="danger-fill"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('projects.lifecycle.deleteDraft')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
