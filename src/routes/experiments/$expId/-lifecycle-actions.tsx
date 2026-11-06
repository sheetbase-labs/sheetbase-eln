import { ShareWithClientDialog } from '#/components/client-sharing/share-with-client-dialog'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { projectOption } from '#/components/record-picker/entity-options'
import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { undoToast } from '#/lib/undo-toast'
import { Icon } from '#/components/icons'
import {
  RecordActionItems,
  RecordActionsMenu,
  RecordMainActionsSlot,
  useOfferedRecordActions,
  useRecordMainActionsHosted,
} from '#/components/notebook/record-actions'
import type { RecordAction } from '#/components/notebook/record-actions'
import type { NextStep } from '#/components/experiments/next-step'
import { useFavouriteState } from '#/lib/favourites'
import { bookInstrumentLink } from '#/components/experiments/book-instrument'
import { SaveAsTemplateDialog } from '#/components/experiments/save-as-template-dialog'
import {
  archiveExperiment,
  restoreExperiment,
  createNewRun,
  deleteExperimentDraft,
  moveExperimentToProject,
  setExperimentStatus,
  startExperimentRecord,
} from '#/lib/experiment-lifecycle'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import { experimentQueryKeys } from '../$expId'
import type { useExperimentRecord } from '../$expId'
import { SubmitLabel } from '#/components/experiments/submit-label'
import {
  SeriesOffer,
  useJoinSeries,
} from '#/components/experiments/series-offer'
import {
  dissolveSeries,
  seriesQueryKeys,
  startSeries,
  useIsSeriesHead,
  useSeriesMembership,
} from '#/lib/experiment-series'
import { t } from '#/copy'

type ExperimentRow = NonNullable<ReturnType<typeof useExperimentRecord>['data']>

/** What the notebook offers only to the person who wrote it. */
const AUTHOR_ACTIONS: ReadonlySet<string> = new Set([
  'link-records',
  'withdraw',
  'duplicate',
])

/** The ⋯ menu's three groups: things you do, ways to share, and upkeep. */
function groupOfOffered(action: RecordAction): 'do' | 'share' | 'manage' {
  if (['open-review', 'link-records', 'withdraw'].includes(action.id))
    return 'do'
  if (action.id === 'duplicate') return 'manage'
  return 'share'
}

type DialogKind =
  | 'hold'
  | 'move'
  | 'run'
  | 'template'
  | 'archive'
  | 'delete'
  | 'share'
  | 'dissolve'
  | null

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
  canWrite = true,
  nextStep,
  reviewRevisionId,
}: {
  experiment: ExperimentRow
  /** A viewer still gets Print and the exports, but none of the changes. */
  canWrite?: boolean
  /** The one primary button, and who it is for. */
  nextStep: NextStep
  /** The submitted version a reviewer decides on. */
  reviewRevisionId?: string
}) {
  const allOffered = useOfferedRecordActions()
  // A reviewer reads the submitted version: the author's own actions on the
  // notebook (link records, withdraw, duplicate) are not theirs.
  const offered = nextStep.authoring
    ? allOffered
    : allOffered.filter((action) => !AUTHOR_ACTIONS.has(action.id))
  const favourite = useFavouriteState('record', e.id)
  const hosted = useRecordMainActionsHosted()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [reason, setReason] = useState('')
  const [runTitle, setRunTitle] = useState(
    t('projects.lifecycle.runTitle', { title: e.title }),
  )
  const [moveTo, setMoveTo] = useState('')
  const membership = useSeriesMembership(e.id)
  const seriesHead = useIsSeriesHead(e.id)
  const joinSeries = useJoinSeries()
  const [joinOnRun, setJoinOnRun] = useState(false)

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
    mutationFn: (status: 'on_hold' | 'in_progress' | 'completed') =>
      setExperimentStatus(notebookDataClient, {
        recordId: e.id,
        status,
        reason:
          reason.trim() ||
          (status === 'on_hold'
            ? t('projects.lifecycle.holdReason')
            : status === 'completed'
              ? t('projects.lifecycle.finishReason')
              : e.status === 'completed'
                ? t('projects.lifecycle.reopenReason')
                : t('projects.lifecycle.resumeReason')),
      }),
    onSuccess: async (_data, status) => {
      close()
      await refresh()
      toast(
        status === 'on_hold'
          ? t('projects.lifecycle.onHold')
          : status === 'completed'
            ? t('projects.lifecycle.finished')
            : e.status === 'completed'
              ? t('projects.lifecycle.reopened')
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
      if (joinOnRun) await joinSeries(membership.data, record.id)
      toast(t('projects.lifecycle.created', { identifier: record.identifier }))
      await navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: record.id },
      })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const makeSeries = useMutation({
    mutationFn: () => startSeries(notebookDataClient, e.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: seriesQueryKeys.all })
      toast(t('projects.series.start.done'))
      await navigate({
        to: '/experiments/$expId/series',
        params: { expId: e.id },
      })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const endSeries = useMutation({
    mutationFn: () => dissolveSeries(notebookDataClient, e.id),
    onSuccess: async () => {
      close()
      await queryClient.invalidateQueries({ queryKey: seriesQueryKeys.all })
      toast(t('projects.series.dissolve.done'))
      await navigate({
        to: '/experiments/$expId/notebook',
        params: { expId: e.id },
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
      undoToast(
        t('projects.lifecycle.archived'),
        () => restoreExperiment(notebookDataClient, e.id),
        () => void refresh(),
      )
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
  const locked = Boolean(e.locked_at)
  const { primary, secondary } = nextStep
  // Submit is the main step of a running experiment. The notebook owns the
  // dialog, so it puts the button here itself while it is open; on the other
  // tabs this one takes you to the notebook with the dialog open.
  const submitFromHere =
    !hosted && !locked && (primary === 'submit' || secondary.includes('submit'))
  if (archived || !canWrite) {
    return (
      <>
        <RecordMainActionsSlot />
        <RecordActionsMenu actions={offered} />
      </>
    )
  }

  const submitLink = (variant: 'primary' | 'secondary') => (
    <Button
      variant={variant}
      nativeButton={false}
      render={
        <Link
          to="/experiments/$expId/notebook"
          params={{ expId: e.id }}
          search={{ reopen: 'submit' } as never}
        />
      }
    >
      <SubmitLabel status={e.status} />
    </Button>
  )
  const decideLink = (decide: 'approve' | 'request_changes') => (
    <Button
      variant={decide === 'approve' ? 'primary' : 'secondary'}
      className={decide === 'approve' ? undefined : 'max-md:hidden'}
      nativeButton={false}
      render={
        <Link
          to="/review/$revisionId"
          params={{ revisionId: reviewRevisionId ?? '' }}
          search={{ decide } as never}
        />
      }
    >
      {decide === 'approve'
        ? t('projects.lifecycle.approve')
        : t('projects.lifecycle.requestChanges')}
    </Button>
  )
  const offeredIn = (group: 'do' | 'share' | 'manage') =>
    offered.filter((action) => groupOfOffered(action) === group)
  const items = (group: 'do' | 'share' | 'manage') => offeredIn(group)
  const author = nextStep.authoring

  return (
    <>
      {nextStep.reviewing && reviewRevisionId ? (
        <>
          {decideLink('request_changes')}
          {decideLink('approve')}
        </>
      ) : null}
      {secondary.includes('reopen') ? (
        <Button
          icon="play"
          disabled={hold.isPending}
          onClick={() => hold.mutate('in_progress')}
        >
          {t('projects.lifecycle.reopen')}
        </Button>
      ) : null}
      {secondary.includes('submit') && submitFromHere
        ? submitLink('secondary')
        : null}
      {primary === 'start' ? (
        <Button
          variant="primary"
          icon="play"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {t('projects.lifecycle.start')}
        </Button>
      ) : null}
      {primary === 'finish' ? (
        <Button
          variant="primary"
          icon="check"
          disabled={hold.isPending}
          onClick={() => hold.mutate('completed')}
        >
          {t('projects.lifecycle.finish')}
        </Button>
      ) : null}
      {primary === 'resume' ? (
        <Button
          variant="primary"
          icon="play"
          disabled={hold.isPending}
          onClick={() => hold.mutate('in_progress')}
        >
          {t('projects.lifecycle.resume')}
        </Button>
      ) : null}
      {primary === 'submit' && submitFromHere ? submitLink('primary') : null}
      {/* Submit and Sign, handed up by the notebook while it is open. */}
      <RecordMainActionsSlot />
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
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t('projects.lifecycle.menu.do')}
            </DropdownMenuLabel>
            {nextStep.reviewing && reviewRevisionId ? (
              <DropdownMenuItem
                icon="edit"
                className="md:hidden"
                onClick={() =>
                  void navigate({
                    to: '/review/$revisionId',
                    params: { revisionId: reviewRevisionId },
                    search: { decide: 'request_changes' } as never,
                  })
                }
              >
                {t('projects.lifecycle.requestChanges')}
              </DropdownMenuItem>
            ) : null}
            <RecordActionItems actions={items('do')} />
            {author && isActive ? (
              <DropdownMenuItem icon="pause" onClick={() => setDialog('hold')}>
                {t('projects.lifecycle.putOnHold')}
              </DropdownMenuItem>
            ) : null}
            {author && !locked ? (
              <DropdownMenuItem
                icon="calendar"
                onClick={() => void navigate(bookInstrumentLink(e.id))}
              >
                {t('projects.bookInstrument.label')}
              </DropdownMenuItem>
            ) : null}
            {author && e.project_id ? (
              <DropdownMenuItem icon="copy" onClick={() => setDialog('run')}>
                {t('projects.lifecycle.newRun')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t('projects.lifecycle.menu.share')}
            </DropdownMenuLabel>
            {e.project_id && author ? (
              <DropdownMenuItem icon="share" onClick={() => setDialog('share')}>
                {t('projects.clientSharing.action')}
              </DropdownMenuItem>
            ) : null}
            <RecordActionItems actions={items('share')} />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t('projects.lifecycle.menu.manage')}
            </DropdownMenuLabel>
            <DropdownMenuItem
              icon="pin"
              disabled={favourite.pending}
              onClick={() => favourite.setFavourite(!favourite.isFavourite)}
            >
              {favourite.isFavourite
                ? t('projects.favouriteToggle.remove')
                : t('projects.favouriteToggle.add')}
            </DropdownMenuItem>
            <RecordActionItems actions={items('manage')} />
            {author && !locked && !membership.data && !seriesHead.data ? (
              <DropdownMenuItem
                icon="link"
                disabled={makeSeries.isPending}
                onClick={() => makeSeries.mutate()}
              >
                {t('projects.series.start.action')}
              </DropdownMenuItem>
            ) : null}
            {author && !locked && seriesHead.data ? (
              <DropdownMenuItem
                icon="link"
                onClick={() => setDialog('dissolve')}
              >
                {t('projects.series.dissolve.action')}
              </DropdownMenuItem>
            ) : null}
            {author ? (
              <>
                <DropdownMenuItem
                  icon="template"
                  onClick={() => setDialog('template')}
                >
                  {t('projects.saveAsTemplate.submit')}
                </DropdownMenuItem>
                {isDraft ? (
                  <DropdownMenuItem
                    icon="move"
                    onClick={() => setDialog('move')}
                  >
                    {t('projects.lifecycle.moveItem')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  icon="archive"
                  onClick={() => setDialog('archive')}
                >
                  {t('projects.lifecycle.archive')}
                </DropdownMenuItem>
                {isDraft ? (
                  <DropdownMenuItem danger onClick={() => setDialog('delete')}>
                    {t('projects.lifecycle.deleteDraft')}
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'share' ? (
        <ShareWithClientDialog
          open
          onOpenChange={(open) => (open ? null : close())}
          recordId={e.id}
        />
      ) : null}

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
            <SeriesOffer
              sourceId={e.id}
              checked={joinOnRun}
              onChange={setJoinOnRun}
            />
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
        open={dialog === 'dissolve'}
        onOpenChange={(open) => (open ? null : close())}
      >
        <DialogContent>
          <DialogHeader
            title={t('projects.series.dissolve.title', {
              identifier: e.identifier,
            })}
            description={t('projects.series.dissolve.body')}
          />
          <DialogFooter>
            <DialogClose
              render={<Button>{t('common.actions.cancel')}</Button>}
            />
            <Button
              variant="primary"
              disabled={endSeries.isPending}
              onClick={() => endSeries.mutate()}
            >
              {t('projects.series.dissolve.submit')}
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
            <Field label={t('projects.lifecycle.moveDialog.field')}>
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
