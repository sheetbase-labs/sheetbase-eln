import { useState } from 'react'
import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import {
  PageHeader,
  Inspector,
  InspectorSection,
} from '#/components/v3/ui/layout'
import { Tabs } from '#/components/v3/ui/tabs'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import {
  sampleListQueryKeys,
  sampleStatus,
  storageLocationsQueryKey,
} from '#/components/v3/samples/samples-data'
import { MoveSampleDialog } from '#/components/v3/samples/move-dialog'
import { SampleLabelCard } from '#/components/v3/samples/sample-label-card'
import {
  PrintLabelButton,
  SampleLabelPrint,
} from '#/components/v3/samples/sample-label-print'
import { SampleHoldMeter } from '#/components/v3/samples/sample-hold-meter'
import { SampleRecentHistory } from '#/components/v3/samples/sample-recent-history'
import {
  EditDetailsDialog,
  EditHoldDialog,
  ReceiveStockDialog,
} from '#/components/v3/samples/sample-edit-dialogs'
import { AliquotDialog } from '#/components/v3/samples/aliquot-dialog'
import type { AliquotDialogInput } from '#/components/v3/samples/aliquot-dialog'
import { ReleaseChecksPanel } from '#/components/v3/samples/release-checks-panel'
import { SampleStateBanner } from '#/components/v3/samples/sample-state-banner'
import {
  canDisposeSample,
  canEditSample,
  canQuarantineSample,
  canReleaseSample,
  canWithdrawSample,
  isTerminalSampleStatus,
  sampleStateKind,
} from '#/components/v3/samples/sample-state'
import {
  aliquotSample,
  archiveSample,
  createSampleReservation,
  describeSampleError,
  disposeSample,
  editSample,
  fetchSample,
  fetchSampleDerivedSamples,
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
  transferSample,
  withdrawSample,
} from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import {
  ReserveDialog,
  SampleActionsProvider,
  WithdrawDialog,
  describeWithdrawError,
} from '#/components/v3/samples/withdraw-dialog'
import type {
  ReserveDialogInput,
  WithdrawDialogInput,
} from '#/components/v3/samples/withdraw-dialog'
import { notebookDataClient } from '#/lib/notebook-data'
import { downloadTextFile } from '#/lib/download'
import { samplePath } from '#/lib/navigation'
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): the sample detail frame, wired to real sample
 * records; Withdraw and Move use the canonical custody RPCs. LAB-02 step 3 adds
 * the truthful hold/quarantine/consumed/disposal banner and the capability-gated
 * release, quarantine and disposal actions the design places on the page. */
export const Route = createFileRoute('/samples/$sampleId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    await resolveIdentifierParam({
      entity: 'sample',
      ref: params.sampleId,
      href: location.href,
    })
    return { context }
  },
  component: SampleLayout,
})

export const sampleQueryKey = (recordId: string) =>
  ['ui-port', 'sample', recordId] as const

export const sampleEventsQueryKey = (recordId: string) =>
  ['ui-port', 'sample-events', recordId] as const

export function useSampleRecord(recordId: string) {
  return useQuery({
    queryKey: sampleQueryKey(recordId),
    queryFn: () => fetchSample(notebookDataClient, recordId),
  })
}

/**
 * LAB-03 — the export behind "Export lineage" on the sample header and the
 * Lineage tab. There is no server-side export job, so the file is written from
 * the lineage the caller already rendered; it returns false when there is
 * nothing to write, so the caller can say so rather than promise a link. A
 * browser that refuses the download throws, so the caller states that too.
 */
export function downloadLineageCsv(
  identifier: string,
  rows: {
    identifier: string
    title: string | null
    relation: string | null
    status: string | null
  }[],
): boolean {
  if (rows.length === 0) return false
  const lines = rows.map((row) =>
    [row.identifier, row.title, row.relation, row.status]
      .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(','),
  )
  downloadTextFile(
    `${identifier}-lineage.csv`,
    ['sample,title,relation,status', ...lines].join('\n'),
    'text/csv',
  )
  return true
}

type SampleDialog =
  | null
  | 'withdraw'
  | 'aliquot'
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

function SampleLayout() {
  const { sampleId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const query = useSampleRecord(sampleId)
  const sample = query.data
  const [dialog, setDialog] = useState<SampleDialog>(null)
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
  const onError = (error: unknown) => {
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
          ? 'Volume withdrawn and container created'
          : 'Volume withdrawn',
      )
      setDialog(null)
    },
    onError: (error) =>
      toast.error(describeWithdrawError(error, sample?.quantityUnit ?? null)),
  })
  const aliquot = useMutation({
    mutationFn: (input: AliquotDialogInput) =>
      aliquotSample(notebookDataClient, {
        recordId: sampleId,
        count: input.count,
        quantityEach: input.quantityEach,
        purposeExperimentId: input.purposeExperimentId,
        unit: input.unit,
        newContainer: input.newContainer,
        expectedMetadataVersion: sample!.metadataVersion,
      }),
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
        `${result.derivedSamples.length} ${result.derivedSamples.length === 1 ? 'tube' : 'tubes'} made`,
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
      toast('Volume reserved')
      setDialog(null)
    },
    onError: (error) =>
      toast.error(describeWithdrawError(error, sample?.quantityUnit ?? null)),
  })
  const move = useMutation({
    mutationFn: (input: { toLocation: string; notes?: string }) =>
      transferSample(notebookDataClient, {
        recordId: sampleId,
        toLocation: input.toLocation,
        expectedMetadataVersion: sample!.metadataVersion,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate()
      toast('Sample moved')
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
      toast('Sample released')
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
      toast('Sample updated')
      setDialog(null)
    },
    onError,
  })
  const receive = useMutation({
    mutationFn: (input: {
      quantity: number
      location?: string
      notes?: string
    }) =>
      receiveSample(notebookDataClient, {
        recordId: sampleId,
        quantity: input.quantity,
        unit: sample?.quantityUnit ?? undefined,
        location: input.location,
        notes: input.notes,
        expectedMetadataVersion: sample!.metadataVersion,
      }),
    onSuccess: () => {
      invalidate()
      toast('Stock received')
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
    onSuccess: () => {
      invalidate()
      toast('Sample archived')
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
      toast('Sample restored')
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
      toast('Sample quarantined')
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
      toast('Sample disposed')
      setDialog(null)
    },
    onError,
  })

  if (!sample) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Samples', link: { to: '/samples' } }]}
          title={query.isLoading ? 'Loading sample…' : 'Sample not found'}
        />
      </div>
    )
  }

  const status = sampleStatus(sample.status)
  const params = { sampleId: sample.id }
  const role = context.workspace?.role
  const state = sampleStateKind(sample)
  const terminal = isTerminalSampleStatus(sample.status)
  const withdrawable = canWithdrawSample(sample.status)
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
      if (!wrote)
        toast('Nothing to export — this sample has no derived lineage yet.')
    } catch (error) {
      toast('Could not export lineage', {
        description:
          error instanceof Error ? error.message : 'The download failed.',
      })
    }
  }

  const bannerAction =
    state === 'quarantined' ? (
      <Button
        size="sm"
        nativeButton={false}
        render={<Link to="/samples/$sampleId/measurements" params={params} />}
      >
        View release basis
      </Button>
    ) : state === 'hold_exceeded' || state === 'expired' ? (
      <span className="flex gap-2">
        {allowEdit ? (
          <Button size="sm" onClick={() => setDialog('hold')}>
            Extend hold…
          </Button>
        ) : null}
        {showDispose ? (
          <Button size="sm" onClick={() => setDialog('dispose')}>
            Record disposal
          </Button>
        ) : null}
      </span>
    ) : undefined

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          className="px-4 md:px-8"
          trail={[
            { label: 'Samples', link: { to: '/samples' } },
            { label: sample.identifier, mono: true },
          ]}
          title={sample.title}
          meta={
            <>
              <span className="text-fg">
                <Status tone={status.tone}>{status.label}</Status>
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
            <span className="flex gap-2 max-md:hidden">
              {archived ? (
                allowEdit ? (
                  <Button
                    variant="primary"
                    onClick={() => setDialog('restore')}
                  >
                    Restore sample…
                  </Button>
                ) : null
              ) : terminal ? (
                <Button onClick={exportLineage}>Export lineage</Button>
              ) : (
                <>
                  <Button
                    nativeButton={false}
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
                    New experiment
                  </Button>
                  <PrintLabelButton record={sample} onPrinted={invalidate} />
                  <Button onClick={() => setDialog('move')}>Move</Button>
                  <Button
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
                    Record reading
                  </Button>
                  {withdrawable ? (
                    <Button onClick={() => setDialog('aliquot')}>
                      Aliquot…
                    </Button>
                  ) : null}
                  {withdrawable ? (
                    <Button
                      variant="primary"
                      onClick={() => setDialog('withdraw')}
                    >
                      Withdraw volume…
                    </Button>
                  ) : null}
                  {showRelease ? (
                    <Button
                      variant="primary"
                      onClick={() => setDialog('release')}
                    >
                      {state === 'quarantined' ? 'Release…' : 'Re-qualify…'}
                    </Button>
                  ) : null}
                  {allowQuarantine &&
                  sample.status !== 'quarantined' &&
                  !showDispose ? (
                    <Button onClick={() => setDialog('quarantine')}>
                      Quarantine…
                    </Button>
                  ) : null}
                </>
              )}
            </span>
          }
          tabs={
            <Tabs
              mode="url"
              label="Sample sections"
              items={[
                {
                  label: 'Details',
                  link: {
                    to: '/samples/$sampleId',
                    params,
                    activeOptions: { exact: true },
                  },
                },
                {
                  label: 'Lineage',
                  count: derivedSamples.data?.length ?? undefined,
                  link: { to: '/samples/$sampleId/lineage', params },
                },
                {
                  label: 'Usage',
                  count: usageCount,
                  link: { to: '/samples/$sampleId/usage', params },
                },
                {
                  label: 'Measurements',
                  count: measurements.data?.length ?? undefined,
                  link: { to: '/samples/$sampleId/measurements', params },
                },
                {
                  label: 'History',
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
          action={bannerAction}
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

      {!terminal && !archived ? (
        <Inspector aria-label="Sample context" className="w-[300px]">
          <InspectorSection title="Label">
            <SampleLabelCard record={sample} />
          </InspectorSection>
          {state === 'quarantined' ? (
            <InspectorSection title="Release checks">
              <ReleaseChecksPanel sampleId={sample.id} />
            </InspectorSection>
          ) : null}
          <InspectorSection title="Hold time">
            <SampleHoldMeter record={sample} />
            {allowEdit ? (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => setDialog('hold')}
              >
                Edit hold…
              </Button>
            ) : null}
          </InspectorSection>
          {allowEdit ? (
            <InspectorSection title="Manage">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDialog('edit')}>
                  Edit details…
                </Button>
                <Button size="sm" onClick={() => setDialog('receive')}>
                  Receive stock…
                </Button>
                <Button size="sm" onClick={() => setDialog('archive')}>
                  Archive…
                </Button>
              </div>
            </InspectorSection>
          ) : null}
          <InspectorSection title="Recent history">
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

      {dialog === 'withdraw' ? (
        <WithdrawDialog
          open
          onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
          sample={sample}
          busy={withdraw.isPending}
          onSubmit={(input) => withdraw.mutate(input)}
        />
      ) : null}
      {dialog === 'aliquot' ? (
        <AliquotDialog
          open
          onOpenChange={(open) => {
            setDialog(open ? 'aliquot' : null)
            if (!open) aliquot.reset()
          }}
          sample={sample}
          busy={aliquot.isPending}
          error={
            aliquot.isError
              ? describeWithdrawError(aliquot.error, sample.quantityUnit)
              : null
          }
          created={aliquot.data?.derivedSamples ?? null}
          onSubmit={(input) => aliquot.mutate(input)}
        />
      ) : null}
      {dialog === 'reserve' ? (
        <ReserveDialog
          open
          onOpenChange={(open) => setDialog(open ? 'reserve' : null)}
          sample={sample}
          busy={reserve.isPending}
          onSubmit={(input) => reserve.mutate(input)}
        />
      ) : null}
      {dialog === 'move' ? (
        <MoveSampleDialog
          open
          onOpenChange={(open) => setDialog(open ? 'move' : null)}
          sample={sample}
          busy={move.isPending}
          onSubmit={(toLocation) => move.mutate({ toLocation })}
        />
      ) : null}
      {dialog === 'edit' ? (
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
      ) : null}
      {dialog === 'hold' ? (
        <EditHoldDialog
          sample={sample}
          busy={edit.isPending}
          onClose={() => setDialog(null)}
          onSubmit={({ reason, ...hold }) =>
            edit.mutate({ properties: hold, reason })
          }
        />
      ) : null}
      {dialog === 'receive' ? (
        <ReceiveStockDialog
          sample={sample}
          busy={receive.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(value) => receive.mutate(value)}
        />
      ) : null}
      <ReasonDialog
        open={dialog === 'archive'}
        onOpenChange={(o) => setDialog(o ? 'archive' : null)}
        title={`Archive ${sample.identifier}`}
        label="Reason (optional)"
        required={false}
        busy={archive.isPending}
        onSubmit={(value) => archive.mutate({ notes: value || undefined })}
      />
      <ReasonDialog
        open={dialog === 'restore'}
        onOpenChange={(o) => setDialog(o ? 'restore' : null)}
        title={`Restore ${sample.identifier}`}
        label="Reason (optional)"
        required={false}
        busy={restore.isPending}
        onSubmit={(value) => restore.mutate({ notes: value || undefined })}
      />
      <ReasonDialog
        open={dialog === 'release'}
        onOpenChange={(o) => {
          setDialog(o ? 'release' : null)
          if (!o) setReleaseFailure(null)
        }}
        title={`${state === 'quarantined' ? 'Release' : 'Re-qualify'} ${sample.identifier}`}
        notice={
          releaseFailure ? (
            <div role="alert" className="text-label text-danger-text">
              <p className="m-0 font-medium">
                Not released. These release checks failed:
              </p>
              <ul className="m-0 mt-1 pl-4">
                {releaseFailure.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
              <p className="m-0 mt-1">
                <Link
                  to="/samples/$sampleId/measurements"
                  params={params}
                  className="text-link"
                  onClick={() => setDialog(null)}
                >
                  Open measurements
                </Link>{' '}
                to see the values these checks read, record the missing ones in
                a dataset or QC run, then try again.
              </p>
            </div>
          ) : null
        }
        label="Notes (optional)"
        required={false}
        busy={release.isPending}
        onSubmit={(value) => release.mutate({ notes: value || undefined })}
      />
      <ReasonDialog
        open={dialog === 'quarantine'}
        onOpenChange={(o) => setDialog(o ? 'quarantine' : null)}
        title={`Quarantine ${sample.identifier}`}
        label="Reason"
        required
        busy={quarantine.isPending}
        onSubmit={(value) => quarantine.mutate({ reason: value })}
      />
      <ReasonDialog
        open={dialog === 'dispose'}
        onOpenChange={(o) => setDialog(o ? 'dispose' : null)}
        title={`Record disposal of ${sample.identifier}`}
        label="Disposal reason"
        required
        busy={dispose.isPending}
        onSubmit={(value) => dispose.mutate({ reason: value })}
      />

      {/* LAB-05.2 / DEC-10: the label document the header's Print label sends
          to the browser's print dialog. It is mounted with the sample frame so
          the action works from every tab; on screen it is hidden, and in print
          only this document reaches the sheet. */}
      <SampleLabelPrint record={sample} />
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
          <DialogClose render={<Button />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={blocked}
            onClick={() => onSubmit(value.trim())}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type { SampleRecord }
