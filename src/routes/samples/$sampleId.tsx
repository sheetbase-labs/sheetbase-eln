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
import { LinkTabs } from '#/components/v3/projects/search-tabs'
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
import { sampleStatus } from '#/components/v3/samples/samples-data'
import { SampleLabelCard } from '#/components/v3/samples/sample-label-card'
import {
  PrintLabelButton,
  SampleLabelPrint,
} from '#/components/v3/samples/sample-label-print'
import { SampleHoldMeter } from '#/components/v3/samples/sample-hold-meter'
import { SampleRecentHistory } from '#/components/v3/samples/sample-recent-history'
import { SampleStateBanner } from '#/components/v3/samples/sample-state-banner'
import {
  canDisposeSample,
  canQuarantineSample,
  canReleaseSample,
  canWithdrawSample,
  isTerminalSampleStatus,
  sampleStateKind,
} from '#/components/v3/samples/sample-state'
import {
  createSampleReservation,
  describeSampleError,
  disposeSample,
  fetchSample,
  fetchSampleDerivedSamples,
  fetchSampleEvents,
  fetchSampleMeasurements,
  fetchSampleReservations,
  quarantineSample,
  releaseSample,
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
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'

/** UI port (roadmap-4/ui-app3): the sample detail frame, wired to real sample
 * records; Withdraw and Move use the canonical custody RPCs. LAB-02 step 3 adds
 * the truthful hold/quarantine/consumed/disposal banner and the capability-gated
 * release, quarantine and disposal actions the design places on the page. */
export const Route = createFileRoute('/samples/$sampleId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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

type SampleDialog =
  null | 'withdraw' | 'reserve' | 'move' | 'release' | 'quarantine' | 'dispose'

function SampleLayout() {
  const { sampleId } = Route.useParams()
  const { context, capabilities } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const query = useSampleRecord(sampleId)
  const sample = query.data
  const [dialog, setDialog] = useState<SampleDialog>(null)
  // R5-SHELL-03: a deployment that records measurements upstream doesn't read
  // them here — the tab entry stays visible, but it carries no count.
  const measurementsEnabled = capabilities.sampleMeasurements

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
    enabled: measurementsEnabled,
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
          crumbs={
            <Link to="/samples" className="text-link">
              Samples
            </Link>
          }
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
  // Release is the design's quarantine exit; hold_exceeded/expired exit through
  // disposal, matching SampleExpired.
  const showRelease = state === 'quarantined' && allowRelease
  const showDispose =
    (state === 'hold_exceeded' || state === 'expired') && allowDispose
  const usageCount =
    (events.data ?? []).filter((event) => event.operation === 'consume')
      .length + (reservations.data?.length ?? 0)

  const bannerAction =
    state === 'quarantined' ? (
      <Button
        size="sm"
        nativeButton={false}
        render={<Link to="/samples/$sampleId/measurements" params={params} />}
      >
        View release checks
      </Button>
    ) : showDispose ? (
      <Button size="sm" onClick={() => setDialog('dispose')}>
        Record disposal
      </Button>
    ) : undefined

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          className="px-4 md:px-8"
          crumbs={
            <>
              <Link to="/samples" className="text-link">
                Samples
              </Link>{' '}
              / <span className="mono">{sample.identifier}</span>
            </>
          }
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
              {terminal ? (
                <Button
                  onClick={() =>
                    toast(
                      'Export started. You will get a link when it is ready.',
                    )
                  }
                >
                  Export lineage
                </Button>
              ) : (
                <>
                  <PrintLabelButton record={sample} onPrinted={invalidate} />
                  <Button onClick={() => setDialog('move')}>Move</Button>
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
                      Release…
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
            <LinkTabs
              tabs={[
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
                  count: measurementsEnabled
                    ? (measurements.data?.length ?? undefined)
                    : undefined,
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
          }}
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
        </SampleActionsProvider>
      </div>

      {!terminal ? (
        <Inspector aria-label="Sample context" className="w-[300px]">
          <InspectorSection title="Label">
            <SampleLabelCard record={sample} />
          </InspectorSection>
          <InspectorSection title="Hold time">
            <SampleHoldMeter record={sample} />
          </InspectorSection>
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
      {dialog === 'reserve' ? (
        <ReserveDialog
          open
          onOpenChange={(open) => setDialog(open ? 'reserve' : null)}
          sample={sample}
          busy={reserve.isPending}
          onSubmit={(input) => reserve.mutate(input)}
        />
      ) : null}
      <TextDialog
        open={dialog === 'move'}
        onOpenChange={(o) => setDialog(o ? 'move' : null)}
        title={`Move ${sample.identifier}`}
        label="New location"
        busy={move.isPending}
        onSubmit={(value) => move.mutate({ toLocation: value })}
      />
      <ReasonDialog
        open={dialog === 'release'}
        onOpenChange={(o) => setDialog(o ? 'release' : null)}
        title={`Release ${sample.identifier}`}
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

function TextDialog({
  open,
  onOpenChange,
  title,
  label,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  busy: boolean
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={title} />
        <DialogBody>
          <Field label={label} required>
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
            disabled={busy}
            onClick={() => {
              if (value.trim()) onSubmit(value.trim())
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReasonDialog({
  open,
  onOpenChange,
  title,
  label,
  required,
  busy,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  required: boolean
  busy: boolean
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const blocked = busy || (required && !value.trim())
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))]">
        <DialogHeader title={title} />
        <DialogBody>
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
