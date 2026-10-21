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
import { Select } from '#/components/v3/ui/select'
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

type ExperimentRow = NonNullable<ReturnType<typeof useExperimentRecord>['data']>

type DialogKind =
  'hold' | 'move' | 'run' | 'template' | 'archive' | 'delete' | null

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'That did not work.'
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
  const [runTitle, setRunTitle] = useState(`${e.title} (run 2)`)
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
      toast('Experiment started')
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
          (status === 'on_hold' ? 'Put on hold' : 'Resumed from the header'),
      }),
    onSuccess: async (_data, status) => {
      close()
      await refresh()
      toast(status === 'on_hold' ? 'Experiment on hold' : 'Experiment resumed')
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
      toast(`${record.identifier} created`)
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
      toast('Moved to the new project')
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const archive = useMutation({
    mutationFn: () => archiveExperiment(notebookDataClient, e.id),
    onSuccess: async () => {
      close()
      await refresh()
      toast('Experiment archived')
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
      toast('Draft deleted')
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
          Start experiment
        </Button>
      ) : null}
      {isActive ? (
        <Button icon="pause" onClick={() => setDialog('hold')}>
          Put on hold
        </Button>
      ) : null}
      {isHold ? (
        <Button
          icon="play"
          disabled={hold.isPending}
          onClick={() => hold.mutate('in_progress')}
        >
          Resume
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="quiet"
              size="icon"
              aria-label="More experiment actions"
            >
              <Icon name="more" size={14} />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {e.project_id ? (
            <DropdownMenuItem icon="copy" onClick={() => setDialog('run')}>
              New run of this experiment
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            icon="template"
            onClick={() => setDialog('template')}
          >
            Save as template
          </DropdownMenuItem>
          {isDraft ? (
            <DropdownMenuItem icon="move" onClick={() => setDialog('move')}>
              Move to another project
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon="archive" onClick={() => setDialog('archive')}>
            Archive
          </DropdownMenuItem>
          {isDraft ? (
            <DropdownMenuItem danger onClick={() => setDialog('delete')}>
              Delete draft
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
            title="Put this experiment on hold"
            description="It stays editable and keeps its place in the project. Say why, so the history explains the pause."
          />
          <DialogBody>
            <Field label="Reason" required>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Waiting on reagent delivery"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button>Cancel</Button>} />
            <Button
              variant="primary"
              disabled={!reason.trim() || hold.isPending}
              onClick={() => hold.mutate('on_hold')}
            >
              Put on hold
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
            title="Start a new run"
            description="A new draft with this experiment's writing, method and protocol, none of its data. It links back here."
          />
          <DialogBody>
            <Field label="Title">
              <Input
                value={runTitle}
                onChange={(event) => setRunTitle(event.target.value)}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button>Cancel</Button>} />
            <Button
              variant="primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              Create run
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
            title="Move this draft"
            description="Only drafts can move. Once started, an experiment stays in its project."
          />
          <DialogBody>
            <Field label="Project">
              <Select
                value={moveTo}
                onChange={(event) => setMoveTo(event.target.value)}
              >
                <option value="">Choose a project</option>
                {(projects.data ?? [])
                  .filter((project) => project.id !== e.project_id)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button>Cancel</Button>} />
            <Button
              variant="primary"
              disabled={!moveTo || move.isPending}
              onClick={() => move.mutate()}
            >
              Move
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
            title={`Archive ${e.identifier}?`}
            description="It leaves the default Experiments list and stays readable under Archived. Nothing is deleted."
          />
          <DialogFooter>
            <DialogClose render={<Button>Cancel</Button>} />
            <Button
              variant="primary"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              Archive
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
            title={`Delete draft ${e.identifier}?`}
            description="A draft that was never started can be removed. This cannot be undone."
          />
          <DialogFooter>
            <DialogClose render={<Button>Cancel</Button>} />
            <Button
              variant="danger-fill"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
