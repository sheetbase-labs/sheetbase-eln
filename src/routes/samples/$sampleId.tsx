import { useState } from 'react'
import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { FollowToggle } from '#/components/follow/follow-toggle'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useRecentViewTracking } from '#/lib/recents'
import { Status } from '#/components/ui/status'
import { PageHeader, Inspector, InspectorSection } from '#/components/ui/layout'
import { Tabs } from '#/components/ui/tabs'
import { Field, Input } from '#/components/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import {
  sampleListQueryKeys,
  sampleStatus,
  storageLocationsQueryKey,
} from '#/components/samples/samples-data'
import { MoveSampleDialog } from '#/components/samples/move-dialog'
import { LabelTemplatePicker } from '#/components/samples/label-template-picker'
import { useLabelTemplateChoice } from '#/components/samples/use-label-template-choice'
import { SampleLabelCard } from '#/components/samples/sample-label-card'
import {
  PrintLabelButton,
  SampleLabelPrint,
} from '#/components/samples/sample-label-print'
import { SampleHoldMeter } from '#/components/samples/sample-hold-meter'
import { SampleRecentHistory } from '#/components/samples/sample-recent-history'
import {
  EditDetailsDialog,
  EditHoldDialog,
  ReceiveStockDialog,
} from '#/components/samples/sample-edit-dialogs'
import { AliquotDialog } from '#/components/samples/aliquot-dialog'
import type { AliquotDialogInput } from '#/components/samples/aliquot-dialog'
import { PoolDialog } from '#/components/samples/pool-dialog'
import type { PoolDialogInput } from '#/components/samples/pool-dialog'
import { ReleaseChecksPanel } from '#/components/samples/release-checks-panel'
import { SampleWorkflowPanel } from '#/components/samples/sample-workflow-panel'
import { SampleStateBanner } from '#/components/samples/sample-state-banner'
import {
  canDisposeSample,
  canEditSample,
  canQuarantineSample,
  canReleaseSample,
  canWithdrawSample,
  isTerminalSampleStatus,
  sampleStateKind,
} from '#/components/samples/sample-state'
import {
  aliquotSample,
  poolSamples,
  archiveSample,
  createSampleReservation,
  describeSampleError,
  disposeSample,
  editSample,
  fetchSample,
  fetchSampleDerivedSamples,
  fetchSampleParentCount,
  sampleParentsQueryKey,
  fetchSampleEvents,
  fetchSampleMeasurements,
  fetchSampleReservations,
  quarantineSample,
  receiveSample,
  releaseFailedChecks,
  releaseSample,
  restoreSample,
  sampleDerivedQueryKey,
  sampleQueryKeys,
  withdrawSample,
} from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import { placeInSequence, placeSample } from '#/lib/sample-placement'
import { fetchSamplePosition } from '#/lib/storage-positions'
import type { PlaceChoice } from '#/lib/storage-positions'
import { canManageSettings } from '#/lib/settings-access'
import {
  ReserveDialog,
  WithdrawDialog,
} from '#/components/samples/withdraw-dialog'
import { SampleActionsProvider } from '#/components/samples/quantity-actions-provider'
import { describeWithdrawError } from '#/components/samples/quantity-input'
import type {
  ReserveDialogInput,
  WithdrawDialogInput,
} from '#/components/samples/withdraw-dialog'
import { notebookDataClient } from '#/lib/notebook-data'
import { downloadLineageCsv } from '#/routes/samples/-lineage-csv'
import {
  sampleEventsQueryKey,
  sampleQueryKey,
} from '#/routes/samples/-sample-keys'
import { samplePath } from '#/lib/navigation'
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { undoToast } from '#/lib/undo-toast'
import { rich, t } from '#/copy'

/** UI port (roadmap-4/ui-app3): the sample detail frame, wired to real sample
 * records; Withdraw and Move use the canonical custody RPCs. LAB-02 step 3 adds
 * the truthful hold/quarantine/consumed/disposal banner and the capability-gated
 * release, quarantine and disposal actions the design places on the page. */
export const Route = createFileRoute('/samples/$sampleId')({
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; the two accepted spellings are compared directly and nothing else is read.
  validateSearch: (search: Record<string, unknown>): { withdraw?: boolean } =>
    search.withdraw === true || search.withdraw === 'true'
      ? { withdraw: true }
      : {},
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    // "New sample" is a dialog on the list, not a sample called "new".
    if (params.sampleId === 'new')
      throw redirect({ to: '/samples', search: { new: true } })
    await resolveIdentifierParam({
      entity: 'sample',
      ref: params.sampleId,
      href: location.href,
    })

    return { context }
  },
  component: SampleLayout,
})

export function useSampleRecord(recordId: string) {
  return useQuery({
    queryKey: sampleQueryKey(recordId),
    queryFn: () => fetchSample(notebookDataClient, recordId),
  })
}

type SampleDialog =
  | null
  | 'withdraw'
  | 'aliquot'
  | 'pool'
  | 'reserve'
  | 'move'
  | 'release'
  | 'quarantine'
  | 'dispose'
  | 'edit'
  | 'hold'
  | 'receive'
  | 'archive'
  | 'restore'

/**
 * The record, its reads and every change the page can make, kept apart from the
 * parts that render them.
 */
function useSamplePage(sampleId: string) {
  const { context } = Route.useRouteContext()
  const canManageStorage = canManageSettings(context.workspace, 'storage')
  const queryClient = useQueryClient()
  const query = useSampleRecord(sampleId)
  const sample = query.data
  useRecentViewTracking('record', sample?.id)
  const labelChoice = useLabelTemplateChoice()
  const [dialog, setDialog] = useState<SampleDialog>(null)
  const [withdrawOpened, setWithdrawOpened] = useState(false)

  // The registry's "Withdraw…" opens the record with the dialog already up;
  // the search is read once the record has arrived, so a slow read still opens it.
  const { withdraw: openWithdraw } = Route.useSearch()

  if (openWithdraw && sample && !withdrawOpened) {
    setWithdrawOpened(true)

    if (canWithdrawSample(sample.status)) setDialog('withdraw')
  }

  // Labels of the release checks the last release attempt failed, shown in the
  // release dialog with a way to the measurements they read.
  const [releaseFailure, setReleaseFailure] = useState<string[] | null>(null)

  const events = useQuery({
    queryKey: sampleEventsQueryKey(sampleId),
    queryFn: () => fetchSampleEvents(notebookDataClient, sampleId),
  })

  const names = useUserNames(
    (events.data ?? []).map((event) => event.actorUserId ?? '').filter(Boolean),
  )

  const derivedSamples = useQuery({
    queryKey: sampleDerivedQueryKey(sampleId),
    queryFn: () => fetchSampleDerivedSamples(notebookDataClient, sampleId),
  })

  const parentCount = useQuery({
    queryKey: sampleParentsQueryKey(sampleId),
    queryFn: () => fetchSampleParentCount(notebookDataClient, sampleId),
  })

  const reservations = useQuery({
    queryKey: sampleQueryKeys.reservations(sampleId),
    queryFn: () => fetchSampleReservations(notebookDataClient, sampleId),
  })

  const measurements = useQuery({
    queryKey: ['ui-port', 'sample-measurements', sampleId],
    queryFn: () => fetchSampleMeasurements(notebookDataClient, sampleId),
  })

  const projectId = sample?.projectId ?? null

  const project = useQuery({
    queryKey: ['ui-port', 'sample-project', projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const rows = await notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        `?id=eq.${projectId}&select=id,title`,
      )

      return rows[0] ?? null
    },
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: sampleQueryKey(sampleId) })
    void queryClient.invalidateQueries({
      queryKey: sampleEventsQueryKey(sampleId),
    })
    void queryClient.invalidateQueries({
      queryKey: sampleQueryKeys.balances(sampleId),
    })
    void queryClient.invalidateQueries({
      queryKey: sampleQueryKeys.reservations(sampleId),
    })
    void queryClient.invalidateQueries({
      queryKey: sampleQueryKeys.releaseChecks(sampleId),
    })
  }

  const onError = (error: Error) => {
    toast.error(describeSampleError(error))
  }

  const withdraw = useMutation({
    mutationFn: (input: WithdrawDialogInput) =>
      withdrawSample(notebookDataClient, {
        recordId: sampleId,
        quantity: input.quantity,
        unit: input.unit,
        purposeExperimentId: input.purposeExperimentId,
        notes: input.notes,
        newContainer: input.newContainer,
        expectedMetadataVersion: sample!.metadataVersion,
      }),
    onSuccess: (result) => {
      invalidate()
      toast(
        result.derivedSample
          ? t('library.samples.record.volumeWithdrawnAndContainerCreated')
          : t('library.samples.record.volumeWithdrawn'),
      )
      setDialog(null)
    },
    onError: (error) =>
      toast.error(describeWithdrawError(error, sample?.quantityUnit ?? null)),
  })

  const aliquot = useMutation({
    mutationFn: async (input: AliquotDialogInput) => {
      const result = await aliquotSample(notebookDataClient, {
        recordId: sampleId,
        count: input.count,
        quantityEach: input.quantityEach,
        purposeExperimentId: input.purposeExperimentId,
        unit: input.unit,
        newContainer: input.newContainer,
        expectedMetadataVersion: sample!.metadataVersion,
      })

      // The tubes are real samples: file them in free positions, starting where
      // the person chose, else beside the source when it sits in a box.
      const start = input.place
        ? {
            boxId: input.place.box.id,
            startPositionId: input.place.position.id,
          }
        : input.newContainer.storageLocation
          ? null
          : await fetchSamplePosition(notebookDataClient, sampleId).then(
              (held) => (held ? { boxId: held.boxId } : null),
            )

      if (start) {
        await placeInSequence(notebookDataClient, result.derivedSamples, start)
      }

      return result
    },
    onSuccess: (result) => {
      invalidate()
      void queryClient.invalidateQueries({
        queryKey: sampleDerivedQueryKey(sampleId),
      })
      void queryClient.invalidateQueries({ queryKey: sampleListQueryKeys.page })
      void queryClient.invalidateQueries({
        queryKey: storageLocationsQueryKey,
      })
      toast(
        t('library.samples.record.tubesMade', {
          count: result.derivedSamples.length,
        }),
      )
    },
  })

  const pool = useMutation({
    mutationFn: async (input: PoolDialogInput) => {
      const result = await poolSamples(notebookDataClient, {
        sources: input.sources,
        purposeExperimentId: input.purposeExperimentId,
        unit: input.unit,
        newContainer: input.newContainer,
      })

      if (input.place) {
        await placeInSequence(notebookDataClient, [result.pool], {
          boxId: input.place.box.id,
          startPositionId: input.place.position.id,
        })
      }

      return result
    },
    onSuccess: (result) => {
      invalidate()

      for (const source of result.sources) {
        void queryClient.invalidateQueries({
          queryKey: sampleQueryKey(source.id),
        })
        void queryClient.invalidateQueries({
          queryKey: sampleEventsQueryKey(source.id),
        })
      }

      void queryClient.invalidateQueries({
        queryKey: sampleDerivedQueryKey(sampleId),
      })
      void queryClient.invalidateQueries({ queryKey: sampleListQueryKeys.page })
      void queryClient.invalidateQueries({
        queryKey: storageLocationsQueryKey,
      })
      toast(
        t('library.samples.record.poolMade', {
          count: result.sources.length,
          identifier: result.pool.identifier,
        }),
      )
    },
  })

  const reserve = useMutation({
    mutationFn: (input: ReserveDialogInput) =>
      createSampleReservation(notebookDataClient, {
        recordId: sampleId,
        experimentId: input.experimentId,
        quantity: input.quantity,
        unit: input.unit,
        planned: input.planned,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.volumeReserved'))
      setDialog(null)
    },
    onError: (error) =>
      toast.error(describeWithdrawError(error, sample?.quantityUnit ?? null)),
  })

  const move = useMutation({
    mutationFn: (input: { choice: PlaceChoice; notes?: string }) =>
      placeSample(notebookDataClient, {
        recordId: sampleId,
        choice: input.choice,
        hasLocation: Boolean(sample!.storageLocation),
        expectedMetadataVersion: sample!.metadataVersion,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.sampleMoved'))
      setDialog(null)
    },
    onError,
  })

  const release = useMutation({
    mutationFn: (input: { notes?: string }) =>
      releaseSample(notebookDataClient, {
        recordId: sampleId,
        expectedMetadataVersion: sample!.metadataVersion,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.sampleReleased'))
      setReleaseFailure(null)
      setDialog(null)
    },
    onError: (error) => {
      const failed = releaseFailedChecks(error)

      if (failed) setReleaseFailure(failed)
      else onError(error)
    },
  })

  const edit = useMutation({
    mutationFn: (input: {
      title?: string
      properties?: Parameters<typeof editSample>[1]['properties']
      tags?: string[]
      reason: string
    }) =>
      editSample(notebookDataClient, {
        recordId: sampleId,
        expectedMetadataVersion: sample!.metadataVersion,
        title: input.title,
        properties: input.properties,
        tags: input.tags,
        notes: input.reason,
      }),
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.sampleUpdated'))
      setDialog(null)
    },
    onError,
  })

  const receive = useMutation({
    mutationFn: async (input: {
      quantity: number
      place?: PlaceChoice
      notes?: string
    }) => {
      const received = await receiveSample(notebookDataClient, {
        recordId: sampleId,
        quantity: input.quantity,
        unit: sample?.quantityUnit ?? undefined,
        location:
          input.place?.kind === 'text' ? input.place.text.trim() : undefined,
        notes: input.notes,
        expectedMetadataVersion: sample!.metadataVersion,
      })

      if (input.place?.kind === 'position') {
        await placeSample(notebookDataClient, {
          recordId: sampleId,
          choice: input.place,
          hasLocation: Boolean(received.storageLocation),
          expectedMetadataVersion: received.metadataVersion,
          notes: input.notes,
        })
      }
    },
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.stockReceived'))
      setDialog(null)
    },
    onError,
  })

  const archive = useMutation({
    mutationFn: (input: { notes?: string }) =>
      archiveSample(notebookDataClient, {
        recordId: sampleId,
        expectedMetadataVersion: sample!.metadataVersion,
        notes: input.notes,
      }),
    onSuccess: (archived) => {
      invalidate()
      undoToast(
        t('library.samples.record.sampleArchived'),
        () =>
          restoreSample(notebookDataClient, {
            recordId: sampleId,
            expectedMetadataVersion: archived.metadataVersion,
          }),
        invalidate,
      )
      setDialog(null)
    },
    onError,
  })

  const restore = useMutation({
    mutationFn: (input: { notes?: string }) =>
      restoreSample(notebookDataClient, {
        recordId: sampleId,
        expectedMetadataVersion: sample!.metadataVersion,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.sampleRestored'))
      setDialog(null)
    },
    onError,
  })

  const quarantine = useMutation({
    mutationFn: (input: { reason: string; notes?: string }) =>
      quarantineSample(notebookDataClient, {
        recordId: sampleId,
        expectedMetadataVersion: sample!.metadataVersion,
        reason: input.reason,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.sampleQuarantined'))
      setDialog(null)
    },
    onError,
  })

  const dispose = useMutation({
    mutationFn: (input: { reason: string; notes?: string }) =>
      disposeSample(notebookDataClient, {
        recordId: sampleId,
        expectedMetadataVersion: sample!.metadataVersion,
        reason: input.reason,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate()
      toast(t('library.samples.record.sampleDisposed'))
      setDialog(null)
    },
    onError,
  })

  return {
    sampleId,
    context,
    canManageStorage,
    queryClient,
    query,
    sample,
    labelChoice,
    dialog,
    setDialog,
    releaseFailure,
    setReleaseFailure,
    events,
    names,
    derivedSamples,
    parentCount,
    reservations,
    measurements,
    projectId,
    project,
    invalidate,
    withdraw,
    aliquot,
    pool,
    reserve,
    move,
    release,
    edit,
    receive,
    archive,
    restore,
    quarantine,
    dispose,
  }
}

type SamplePage = ReturnType<typeof useSamplePage>

/** The flags the page derives from the record once it has arrived. */
function samplePageFlags(page: SamplePage, sample: SampleRecord) {
  const { context, measurements, events, reservations, derivedSamples } = page

  const status = sampleStatus(
    sample.status,
    sample.releasedAt,
    sample.storageLocation,
  )

  const params = { sampleId: sample.id }
  const role = context.workspace?.role
  const state = sampleStateKind(sample)
  const terminal = isTerminalSampleStatus(sample.status)
  const withdrawable = canWithdrawSample(sample.status)
  // A reading on record settles "Awaiting measurement" for a reserved sample.
  const hasReading = (measurements.data?.length ?? 0) > 0
  const awaitingReading = status.tone === 'progress' && !hasReading
  const allowRelease = canReleaseSample(role)
  const allowQuarantine = canQuarantineSample(role)
  const allowDispose = canDisposeSample(role)
  const allowEdit = canEditSample(role)
  const archived = Boolean(sample.archivedAt)

  // Release is the quarantine exit. A past-hold or expired sample exits through
  // disposal, or through release as a re-qualification once the hold has been
  // extended (the server evaluates the same release checks).
  const showRelease =
    (state === 'quarantined' ||
      state === 'hold_exceeded' ||
      state === 'expired') &&
    allowRelease

  const showDispose =
    (state === 'hold_exceeded' || state === 'expired') && allowDispose

  // QA-121: the tab badge counts live usage — consumptions plus reservations
  // that still hold volume — so a cancelled reservation cannot inflate it.
  const usageCount =
    (events.data ?? []).filter((event) => event.operation === 'consume')
      .length +
    (reservations.data ?? []).filter((row) => row.state !== 'cancelled').length

  const exportLineage = () => {
    try {
      const wrote = downloadLineageCsv(
        sample.identifier,
        (derivedSamples.data ?? []).map((row) => ({
          identifier: row.identifier,
          title: row.title,
          relation: row.relation,
          status: row.status ? sampleStatus(row.status).label : null,
        })),
      )

      if (!wrote) toast(t('library.samples.record.nothingToExportThisSample'))
    } catch (error) {
      toast.error(t('library.samples.record.couldNotExportLineage'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.samples.record.theDownloadFailed'),
      })
    }
  }

  return {
    status,
    params,
    role,
    state,
    terminal,
    withdrawable,
    hasReading,
    awaitingReading,
    allowRelease,
    allowQuarantine,
    allowDispose,
    allowEdit,
    archived,
    showRelease,
    showDispose,
    usageCount,
    exportLineage,
  }
}

/** Everything the header can do with the sample it is showing. */
/** The menu that holds the sample actions the header does not show. */
/** The actions a live sample shows beside its header. */
function SampleMainActions({
  page,
  sample,
  flags,
  onDialog,
}: {
  page: SamplePage
  sample: SampleRecord
  flags: ReturnType<typeof samplePageFlags>
  onDialog: (dialog: SampleDialog) => void
}) {
  const { invalidate } = page
  const { withdrawable, awaitingReading, showRelease, state } = flags

  return (
    <>
      {/* The state picks the main action: a sample waiting for a
        reading is read, anything else is drawn on. Two more
        stay in view; the rest sit under the menu. */}
      <Button
        variant={awaitingReading ? 'primary' : 'secondary'}
        nativeButton={false}
        render={
          <Link
            to="/readings/new"
            search={{
              sample: sample.id,
              returnTo: samplePath(sample.id),
            }}
          />
        }
      >
        {t('library.samples.record.recordReading')}
      </Button>
      {withdrawable ? (
        <Button
          variant={awaitingReading ? 'secondary' : 'primary'}
          onClick={() => onDialog('withdraw')}
        >
          {t('library.samples.record.withdrawVolume')}
        </Button>
      ) : null}
      {showRelease ? (
        <Button variant="primary" onClick={() => onDialog('release')}>
          {state === 'quarantined'
            ? t('library.samples.record.release')
            : t('library.samples.record.reQualify')}
        </Button>
      ) : null}
      <PrintLabelButton record={sample} onPrinted={invalidate} />
      <SampleMoreActions
        page={page}
        sample={sample}
        flags={flags}
        onDialog={onDialog}
      />
    </>
  )
}

function SampleMoreActions({
  page,
  sample,
  flags,
  onDialog,
}: {
  page: SamplePage
  sample: SampleRecord
  flags: ReturnType<typeof samplePageFlags>
  onDialog: (dialog: SampleDialog) => void
}) {
  const { project } = page
  const { allowQuarantine, showDispose, withdrawable } = flags

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            aria-label={t('library.samples.record.moreSampleActions')}
            icon="more"
          />
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={
            <Link
              to="/experiments/new"
              search={{
                project: project.data?.id,
                sample: sample.id,
              }}
            />
          }
        >
          {t('library.samples.record.newExperiment')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDialog('move')}>
          {t('library.samples.record.move')}
        </DropdownMenuItem>
        {withdrawable ? (
          <DropdownMenuItem onClick={() => onDialog('aliquot')}>
            {t('library.samples.record.aliquot')}
          </DropdownMenuItem>
        ) : null}
        {withdrawable ? (
          <DropdownMenuItem onClick={() => onDialog('pool')}>
            {t('library.samples.record.pool')}
          </DropdownMenuItem>
        ) : null}
        {allowQuarantine && sample.status !== 'quarantined' && !showDispose ? (
          <DropdownMenuItem danger onClick={() => onDialog('quarantine')}>
            {t('library.samples.record.quarantine')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The one action the state banner offers for the sample's state. */
function SampleBannerAction({
  page,
  flags,
}: {
  page: SamplePage
  flags: ReturnType<typeof samplePageFlags>
}) {
  const { setDialog } = page
  const { state, params, allowEdit, showDispose } = flags

  return state === 'quarantined' ? (
    <Button
      size="sm"
      nativeButton={false}
      render={<Link to="/samples/$sampleId/measurements" params={params} />}
    >
      {t('library.samples.record.viewReleaseBasis')}
    </Button>
  ) : state === 'hold_exceeded' || state === 'expired' ? (
    <span className="flex gap-2">
      {allowEdit ? (
        <Button size="sm" onClick={() => setDialog('hold')}>
          {t('library.samples.record.extendHold')}
        </Button>
      ) : null}
      {showDispose ? (
        <Button size="sm" onClick={() => setDialog('dispose')}>
          {t('library.samples.record.recordDisposal')}
        </Button>
      ) : null}
    </span>
  ) : undefined
}

function SampleHeaderActions({
  page,
  sample,
  flags,
  onDialog,
}: {
  page: SamplePage
  sample: SampleRecord
  flags: ReturnType<typeof samplePageFlags>
  onDialog: (dialog: SampleDialog) => void
}) {
  const { terminal, exportLineage, allowEdit, archived } = flags

  return (
    <span className="flex flex-wrap gap-2 max-md:hidden">
      <FavouriteToggle kind="record" objectId={sample.id} />
      <FollowToggle kind="record" objectId={sample.id} />
      {archived ? (
        allowEdit ? (
          <Button variant="primary" onClick={() => onDialog('restore')}>
            {t('library.samples.record.restoreSample')}
          </Button>
        ) : null
      ) : terminal ? (
        <Button onClick={exportLineage}>
          {t('library.samples.record.exportLineage')}
        </Button>
      ) : (
        <SampleMainActions
          page={page}
          sample={sample}
          flags={flags}
          onDialog={onDialog}
        />
      )}
    </span>
  )
}

function SampleLayout() {
  const { sampleId } = Route.useParams()
  const page = useSamplePage(sampleId)
  const { sample, query } = page

  if (!sample) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('library.samples.record.samples'),
              link: { to: '/samples' },
            },
          ]}
          title={
            query.isLoading
              ? t('library.samples.record.loadingSample')
              : t('library.samples.record.sampleNotFound')
          }
        />
        <RecordUnavailable
          query={query}
          what={t('settings.uiKit.recordUnavailable.sample')}
          back={{
            to: '/samples',
            label: t('settings.uiKit.recordUnavailable.backToSamples'),
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <SamplePageHeader page={page} sample={sample} />
      </div>
      <SampleInspector page={page} sample={sample} />
      <SampleDialogs page={page} sample={sample} />
    </div>
  )
}

/** The record's header, its state banner and the tabs its screens sit in. */
function SamplePageHeader({
  page,
  sample,
}: {
  page: SamplePage
  sample: SampleRecord
}) {
  const {
    setDialog,
    events,
    names,
    derivedSamples,
    parentCount,
    measurements,
    project,
  } = page

  const flags = samplePageFlags(page, sample)
  const { status, params, withdrawable, hasReading, usageCount } = flags

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        className="px-4 md:px-8"
        trail={[
          {
            label: t('library.samples.record.samples'),
            link: { to: '/samples' },
          },
          { label: sample.identifier, mono: true },
        ]}
        title={sample.title}
        meta={
          <>
            <span className="text-fg">
              <Status tone={status.tone}>
                {status.tone === 'progress' && hasReading
                  ? t('library.samples.record.reserved')
                  : status.label}
              </Status>
            </span>
            <span>{sample.sampleType ?? '—'}</span>
            {project.data ? (
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.data.id }}
                className="text-link"
              >
                {project.data.title}
              </Link>
            ) : null}
          </>
        }
        actions={
          <SampleHeaderActions
            page={page}
            sample={sample}
            flags={flags}
            onDialog={setDialog}
          />
        }
        tabs={
          <Tabs
            mode="url"
            label={t('library.samples.record.sampleSections')}
            items={[
              {
                label: t('library.samples.record.details'),
                link: {
                  to: '/samples/$sampleId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: t('library.samples.record.lineage'),
                count:
                  derivedSamples.data && parentCount.data != null
                    ? derivedSamples.data.length + parentCount.data
                    : undefined,
                link: { to: '/samples/$sampleId/lineage', params },
              },
              {
                label: t('library.samples.record.usage'),
                count: usageCount,
                link: { to: '/samples/$sampleId/usage', params },
              },
              {
                label: t('library.samples.record.measurements'),
                count: measurements.data?.length ?? undefined,
                link: { to: '/samples/$sampleId/measurements', params },
              },
              {
                label: t('library.samples.record.sequences'),
                link: { to: '/samples/$sampleId/sequences', params },
              },
              {
                label: t('library.samples.record.history'),
                link: { to: '/samples/$sampleId/history', params },
              },
            ]}
          />
        }
      />

      <SampleStateBanner
        sample={sample}
        events={events.data}
        userName={(userId) => names.names[userId] ?? null}
        action={<SampleBannerAction page={page} flags={flags} />}
      />

      <SampleActionsProvider
        actions={{
          openWithdraw: () => setDialog('withdraw'),
          openReserve: () => setDialog('reserve'),
          canWithdraw: withdrawable,
        }}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </SampleActionsProvider>
    </div>
  )
}

/** The panel beside the record: its label, release checks, hold and recent history. */
function SampleInspector({
  page,
  sample,
}: {
  page: SamplePage
  sample: SampleRecord
}) {
  const { labelChoice, setDialog, events, names, measurements } = page
  const { state, terminal, allowEdit, archived } = samplePageFlags(page, sample)

  return (
    <>
      {!terminal && !archived ? (
        <Inspector
          aria-label={t('library.samples.record.sampleContext')}
          className="w-[300px]"
        >
          <InspectorSection title={t('library.samples.record.label')}>
            <SampleLabelCard record={sample} template={labelChoice.chosen} />
            <LabelTemplatePicker
              templates={labelChoice.templates}
              chosen={labelChoice.chosen}
              onChoose={labelChoice.choose}
            />
          </InspectorSection>
          {state === 'quarantined' ? (
            <InspectorSection title={t('library.samples.record.releaseChecks')}>
              <ReleaseChecksPanel
                sampleId={sample.id}
                measurementCount={measurements.data?.length}
              />
            </InspectorSection>
          ) : null}
          <InspectorSection
            title={t('settings.sampleWorkflows.onSample.title')}
          >
            <SampleWorkflowPanel
              sampleId={sample.id}
              sampleType={sample.sampleType ?? null}
              canMove={allowEdit}
            />
          </InspectorSection>
          <InspectorSection title={t('library.samples.record.holdTime')}>
            <SampleHoldMeter record={sample} />
            {allowEdit ? (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => setDialog('hold')}
              >
                {t('library.samples.record.editHold')}
              </Button>
            ) : null}
          </InspectorSection>
          {allowEdit ? (
            <InspectorSection title={t('library.samples.record.manage')}>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDialog('edit')}>
                  {t('library.samples.record.editDetails')}
                </Button>
                <Button size="sm" onClick={() => setDialog('receive')}>
                  {t('library.samples.record.receiveStock')}
                </Button>
                <Button size="sm" onClick={() => setDialog('archive')}>
                  {t('library.samples.record.archive')}
                </Button>
              </div>
            </InspectorSection>
          ) : null}
          <InspectorSection title={t('library.samples.record.recentHistory')}>
            <SampleRecentHistory
              events={events.data ?? []}
              actorLabel={(event) =>
                event.actorUserId
                  ? (names.names[event.actorUserId] ?? null)
                  : null
              }
            />
          </InspectorSection>
        </Inspector>
      ) : null}
    </>
  )
}

/** Every dialog the record's actions open, and the label document it prints. */
function SampleDialogs({
  page,
  sample,
}: {
  page: SamplePage
  sample: SampleRecord
}) {
  const {
    canManageStorage,
    labelChoice,
    dialog,
    setDialog,
    releaseFailure,
    setReleaseFailure,
    withdraw,
    aliquot,
    pool,
    reserve,
    move,
    release,
    edit,
    receive,
    archive,
    restore,
    quarantine,
    dispose,
  } = page

  const { params, state } = samplePageFlags(page, sample)

  const dialogs = {
    withdraw: (
      <WithdrawDialog
        open
        onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
        sample={sample}
        busy={withdraw.isPending}
        onSubmit={(input) => withdraw.mutate(input)}
      />
    ),
    aliquot: (
      <AliquotDialog
        open
        onOpenChange={(open) => {
          setDialog(open ? 'aliquot' : null)

          if (!open) aliquot.reset()
        }}
        sample={sample}
        busy={aliquot.isPending}
        canManageStorage={canManageStorage}
        error={
          aliquot.isError
            ? describeWithdrawError(aliquot.error, sample.quantityUnit)
            : null
        }
        created={aliquot.data?.derivedSamples ?? null}
        onSubmit={(input) => aliquot.mutate(input)}
      />
    ),
    pool: (
      <PoolDialog
        open
        onOpenChange={(open) => {
          setDialog(open ? 'pool' : null)

          if (!open) pool.reset()
        }}
        sample={sample}
        busy={pool.isPending}
        canManageStorage={canManageStorage}
        error={
          pool.isError
            ? describeWithdrawError(pool.error, sample.quantityUnit)
            : null
        }
        created={pool.data ?? null}
        onSubmit={(input) => pool.mutate(input)}
      />
    ),
    reserve: (
      <ReserveDialog
        open
        onOpenChange={(open) => setDialog(open ? 'reserve' : null)}
        sample={sample}
        busy={reserve.isPending}
        onSubmit={(input) => reserve.mutate(input)}
      />
    ),
    move: (
      <MoveSampleDialog
        open
        onOpenChange={(open) => setDialog(open ? 'move' : null)}
        sample={sample}
        busy={move.isPending}
        onSubmit={(choice) => move.mutate({ choice })}
        canManageStorage={canManageStorage}
      />
    ),
    edit: (
      <EditDetailsDialog
        sample={sample}
        busy={edit.isPending}
        onClose={() => setDialog(null)}
        onSubmit={(value) =>
          edit.mutate({
            title: value.title,
            tags: value.tags,
            properties: { notes: value.notes },
            reason: value.reason,
          })
        }
      />
    ),
    hold: (
      <EditHoldDialog
        sample={sample}
        busy={edit.isPending}
        onClose={() => setDialog(null)}
        onSubmit={({ reason, ...hold }) =>
          edit.mutate({ properties: hold, reason })
        }
      />
    ),
    receive: (
      <ReceiveStockDialog
        sample={sample}
        busy={receive.isPending}
        canManageStorage={canManageStorage}
        onClose={() => setDialog(null)}
        onSubmit={(value) => receive.mutate(value)}
      />
    ),
    archive: (
      <ReasonDialog
        open
        onOpenChange={(o) => setDialog(o ? 'archive' : null)}
        title={t('library.samples.record.archive2', {
          identifier: sample.identifier,
        })}
        label={t('library.samples.record.reasonOptional')}
        required={false}
        busy={archive.isPending}
        onSubmit={(value) => archive.mutate({ notes: value || undefined })}
      />
    ),
    restore: (
      <ReasonDialog
        open
        onOpenChange={(o) => setDialog(o ? 'restore' : null)}
        title={t('library.samples.record.restore', {
          identifier: sample.identifier,
        })}
        label={t('library.samples.record.reasonOptional')}
        required={false}
        busy={restore.isPending}
        onSubmit={(value) => restore.mutate({ notes: value || undefined })}
      />
    ),
    release: (
      <ReasonDialog
        open
        onOpenChange={(o) => {
          setDialog(o ? 'release' : null)

          if (!o) setReleaseFailure(null)
        }}
        title={`${state === 'quarantined' ? t('library.samples.record.release2') : 'Re-qualify'} ${sample.identifier}`}
        notice={
          releaseFailure ? (
            <div role="alert" className="text-label text-danger-text">
              <p className="m-0 font-medium">
                {t('library.samples.record.notReleasedTheseReleaseChecks')}
              </p>
              <ul className="m-0 mt-1 pl-4">
                {releaseFailure.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
              <p className="m-0 mt-1">
                {rich('library.samples.record.openMeasurementsToSeeThe', {
                  link: (text) => (
                    <Link
                      to="/samples/$sampleId/measurements"
                      params={params}
                      className="text-link"
                      onClick={() => setDialog(null)}
                    >
                      {text}
                    </Link>
                  ),
                })}
              </p>
            </div>
          ) : null
        }
        label={t('library.samples.record.notesOptional')}
        required={false}
        busy={release.isPending}
        onSubmit={(value) => release.mutate({ notes: value || undefined })}
      />
    ),
    quarantine: (
      <ReasonDialog
        open
        onOpenChange={(o) => setDialog(o ? 'quarantine' : null)}
        title={t('library.samples.record.quarantine2', {
          identifier: sample.identifier,
        })}
        label={t('library.samples.record.reason')}
        required
        busy={quarantine.isPending}
        onSubmit={(value) => quarantine.mutate({ reason: value })}
      />
    ),
    dispose: (
      <ReasonDialog
        open
        onOpenChange={(o) => setDialog(o ? 'dispose' : null)}
        title={t('library.samples.record.recordDisposalOf', {
          identifier: sample.identifier,
        })}
        label={t('library.samples.record.disposalReason')}
        required
        busy={dispose.isPending}
        onSubmit={(value) => dispose.mutate({ reason: value })}
      />
    ),
  } satisfies Record<NonNullable<SampleDialog>, React.ReactElement>

  return (
    <div>
      {dialog ? dialogs[dialog] : null}

      {/* LAB-05.2 / DEC-10: the label document the header's Print label sends
          to the browser's print dialog. It is mounted with the sample frame so
      the action works from every tab; on screen it is hidden, and in print
      only this document reaches the sheet. */}
      <SampleLabelPrint record={sample} template={labelChoice.chosen} />
    </div>
  )
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  label,
  required,
  busy,
  notice,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  required: boolean
  busy: boolean
  notice?: React.ReactNode
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const blocked = busy || (required && !value.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={title} />
        <DialogBody>
          {notice}
          <Field label={label} required={required}>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={blocked}
            onClick={() => onSubmit(value.trim())}
          >
            {t('common.actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type { SampleRecord }
