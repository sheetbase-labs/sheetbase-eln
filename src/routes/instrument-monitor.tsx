/** OPS-006 — Instrument Run Monitor route. */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Activity, AlertCircle, Play } from 'lucide-react'

import { useShell } from '#/components/shell'
import {
  RunDetail,
  RunInspector,
  RunQueue,
} from '#/components/instrument-monitor'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  PageHeader,
  Separator,
  Skeleton,
} from '#/components/ui'
import { createDataClient } from '#/lib/data-client'
import {
  createInstrument,
  createInstrumentRun,
  createPlateSnapshot,
  createQpcrFixtureStream,
  describeInstrumentMonitorError,
  fetchInstrumentRuns,
  fetchInstruments,
  fetchObservations,
  fetchPlateSnapshots,
  fetchQcChecks,
  fetchRawFiles,
  fetchRunLinks,
  fetchRunStages,
  ingestObservation,
  instrumentMonitorQueryKeys,
  recordQcCheck,
  startInstrumentRun,
} from '#/lib/instrument-monitor'
import type { JsonObject } from '#/lib/instrument-monitor'

export const Route = createFileRoute('/instrument-monitor')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: InstrumentMonitorRoute,
})

const dataClient = createDataClient()
const VIEW_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function InstrumentMonitorRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const workspaceId = context.workspace?.id ?? ''
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const instrumentsQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.instruments(workspaceId),
    queryFn: () => fetchInstruments(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const runsQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.runs(workspaceId),
    queryFn: () => fetchInstrumentRuns(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
  })
  const stagesQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.stages(selectedRunId ?? 'none'),
    queryFn: () => fetchRunStages(dataClient, selectedRunId!),
    enabled: Boolean(selectedRunId),
  })
  const observationsQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.observations(selectedRunId ?? 'none'),
    queryFn: () => fetchObservations(dataClient, selectedRunId!),
    enabled: Boolean(selectedRunId),
  })
  const snapshotsQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.plateSnapshots(
      selectedRunId ?? 'none',
    ),
    queryFn: () => fetchPlateSnapshots(dataClient, selectedRunId!),
    enabled: Boolean(selectedRunId),
  })
  const qcChecksQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.qcChecks(selectedRunId ?? 'none'),
    queryFn: () => fetchQcChecks(dataClient, selectedRunId!),
    enabled: Boolean(selectedRunId),
  })
  const rawFilesQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.rawFiles(selectedRunId ?? 'none'),
    queryFn: () => fetchRawFiles(dataClient, selectedRunId!),
    enabled: Boolean(selectedRunId),
  })
  const runLinksQuery = useQuery({
    queryKey: instrumentMonitorQueryKeys.runLinks(selectedRunId ?? 'none'),
    queryFn: () => fetchRunLinks(dataClient, selectedRunId!),
    enabled: Boolean(selectedRunId),
  })

  const instruments = instrumentsQuery.data ?? []
  const runs = runsQuery.data ?? []
  const filteredRuns = useMemo(
    () => runs.filter((run) => run.workspaceId === workspaceId),
    [runs, workspaceId],
  )
  const selectedRun = useMemo(
    () => filteredRuns.find((run) => run.id === selectedRunId) ?? null,
    [filteredRuns, selectedRunId],
  )
  const selectedInstrument = useMemo(
    () =>
      instruments.find(
        (instrument) => instrument.id === selectedRun?.instrumentId,
      ) ?? null,
    [instruments, selectedRun],
  )
  const summaryMetrics = useMemo(() => {
    const liveRuns = filteredRuns.filter((r) => r.status === 'running').length
    const queuedRuns = filteredRuns.filter((r) => r.status === 'queued').length
    const failedRuns = filteredRuns.filter((r) => r.status === 'failed').length
    const now = new Date()
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime()
    const completedToday = filteredRuns.filter(
      (r) =>
        r.status === 'completed' &&
        r.completedAt &&
        new Date(r.completedAt).getTime() >= startOfToday,
    ).length
    const instrumentsOnline = instruments.filter(
      (i) => i.connectionStatus === 'connected',
    ).length
    return {
      liveRuns,
      queuedRuns,
      completedToday,
      failedRuns,
      instrumentsOnline,
      instrumentsTotal: instruments.length,
    }
  }, [filteredRuns, instruments])

  function invalidateAll(runId: string | null = selectedRunId) {
    void queryClient.invalidateQueries({
      queryKey: ['ops-006', 'instruments', workspaceId],
    })
    void queryClient.invalidateQueries({
      queryKey: ['ops-006', 'runs', workspaceId],
    })
    if (!runId) return
    for (const key of [
      instrumentMonitorQueryKeys.runDetail(runId),
      instrumentMonitorQueryKeys.stages(runId),
      instrumentMonitorQueryKeys.observations(runId),
      instrumentMonitorQueryKeys.plateSnapshots(runId),
      instrumentMonitorQueryKeys.qcChecks(runId),
      instrumentMonitorQueryKeys.rawFiles(runId),
      instrumentMonitorQueryKeys.runLinks(runId),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const simulateMutation = useMutation({
    mutationFn: async () => {
      let instrumentId = instruments[0]?.id
      if (!instrumentId) {
        const instrument = await createInstrument(dataClient, {
          workspaceId,
          name: 'Demo qPCR Instrument',
          instrumentType: 'qpcr',
          model: 'QuantStudio 5',
          serialNumber: 'QS5-001',
          vendor: 'Applied Biosystems',
        })
        instrumentId = instrument.id
      }

      const fixture = createQpcrFixtureStream()
      const run = await createInstrumentRun(dataClient, {
        workspaceId,
        instrumentId,
        name: 'Simulated qPCR Run',
        runIdentifier: `SIM-${Date.now()}`,
        protocolName: 'qPCR fixture protocol',
        estimatedDurationSeconds: 2520,
        stages: [
          {
            name: 'Hold',
            stageType: 'hold',
            cycleCount: 1,
            targetTemperature: 50,
            durationSeconds: 120,
          },
          {
            name: 'Cycling',
            stageType: 'cycling',
            cycleCount: 40,
            targetTemperature: 60,
            durationSeconds: 1800,
          },
          {
            name: 'Melt Curve',
            stageType: 'melt',
            cycleCount: 1,
            targetTemperature: 95,
            durationSeconds: 600,
          },
        ],
      })
      await startInstrumentRun(dataClient, workspaceId, run.id)
      for (const observation of fixture) {
        await ingestObservation(dataClient, {
          workspaceId,
          runId: run.id,
          sourceId: observation.source_id,
          observationType: observation.observation_type,
          sourceTimestamp: observation.source_timestamp,
          payload: observation.payload,
        })
      }

      const snapshot = fixture.find(
        (item) => item.observation_type === 'plate_snapshot',
      )
      const wells = snapshot?.payload.wells
      await createPlateSnapshot(dataClient, {
        workspaceId,
        runId: run.id,
        wells:
          wells && typeof wells === 'object' && !Array.isArray(wells)
            ? (wells as JsonObject)
            : {},
        cycleNumber: 40,
        capturedAt: snapshot?.source_timestamp,
      })
      await Promise.all([
        recordQcCheck(dataClient, {
          workspaceId,
          runId: run.id,
          checkName: 'Positive control amplified',
          checkType: 'pass',
          detail: { ct: 20.2 },
        }),
        recordQcCheck(dataClient, {
          workspaceId,
          runId: run.id,
          checkName: 'Negative control clean',
          checkType: 'pass',
        }),
        recordQcCheck(dataClient, {
          workspaceId,
          runId: run.id,
          checkName: 'Standard curve R² > 0.98',
          checkType: 'pass',
          detail: { rSquared: 0.992 },
        }),
      ])
      return run.id
    },
    onSuccess: (runId) => {
      setActionError(null)
      setSelectedRunId(runId)
      invalidateAll(runId)
    },
    onError: (cause) => setActionError(describeInstrumentMonitorError(cause)),
  })

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  useShell({
    context: shellContext,
    breadcrumbs: [
      { label: 'Home', to: '/' },
      { label: 'Instrument Run Monitor' },
    ],
    fullBleed: true,
    inspectorLabel: 'Run',
    inspector: (
      <RunInspector
        run={selectedRun}
        instrument={selectedInstrument}
        qcChecks={qcChecksQuery.data ?? []}
        rawFiles={rawFilesQuery.data ?? []}
        runLinks={runLinksQuery.data ?? []}
        timeZone={VIEW_TIMEZONE}
      />
    ),
  })

  return (
    <>
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <div className="px-4 pt-4">
          <PageHeader
            compact
            title="Instrument Run Monitor"
            description="Real-time tracking of qPCR runs, plate reads, and telemetry."
            className="border-0 pb-4"
          >
            <Button
              onClick={() => simulateMutation.mutate()}
              size="sm"
              disabled={simulateMutation.isPending}
            >
              <Play className="size-4" /> Simulate run
            </Button>
          </PageHeader>
          <div className="space-y-1.5 border-b border-border/60 pb-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Activity className="size-4" />
                Live run queue
              </span>
            </div>
            {actionError ? (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            ) : null}
          </div>
        </div>

        {/* Body */}
        {instrumentsQuery.isLoading || runsQuery.isLoading ? (
          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : instrumentsQuery.error || runsQuery.error ? (
          <Alert variant="destructive" className="m-6 max-w-md">
            <AlertCircle className="size-4" />
            <AlertTitle>Couldn't load instrument runs</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>
                {describeInstrumentMonitorError(
                  instrumentsQuery.error ?? runsQuery.error,
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => {
                  if (instrumentsQuery.error) void instrumentsQuery.refetch()
                  if (runsQuery.error) void runsQuery.refetch()
                }}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : filteredRuns.length === 0 ? (
          <Empty className="flex-1 border-0 rounded-none">
            <EmptyIcon>
              <Activity className="size-5" />
            </EmptyIcon>
            <EmptyTitle>No instrument runs yet</EmptyTitle>
            <EmptyDescription>
              Simulate a qPCR run to populate the queue with stages, telemetry,
              and plate snapshots for live monitoring.
            </EmptyDescription>
            <EmptyActions>
              <Button
                onClick={() => simulateMutation.mutate()}
                size="sm"
                disabled={simulateMutation.isPending}
              >
                <Play className="size-4" /> Simulate run
              </Button>
            </EmptyActions>
          </Empty>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 bg-muted/30 px-4 py-2.5 text-sm">
              <span className="font-medium" aria-label="Live runs">
                Live{' '}
                <span className="tabular-nums text-info">
                  {summaryMetrics.liveRuns}
                </span>
              </span>
              <Separator orientation="vertical" className="h-4" />
              <span aria-label="Queued runs">
                <span className="text-muted-foreground">Queued</span>{' '}
                <span className="tabular-nums">
                  {summaryMetrics.queuedRuns}
                </span>
              </span>
              <Separator orientation="vertical" className="h-4" />
              <span aria-label="Completed today">
                <span className="text-muted-foreground">Completed</span>{' '}
                <span className="tabular-nums text-success">
                  {summaryMetrics.completedToday}
                </span>
              </span>
              <Separator orientation="vertical" className="h-4" />
              <span aria-label="Failed runs">
                <span className="text-muted-foreground">Failed</span>{' '}
                <span
                  className={`tabular-nums ${summaryMetrics.failedRuns > 0 ? 'text-destructive' : ''}`}
                >
                  {summaryMetrics.failedRuns}
                </span>
              </span>
              <Separator orientation="vertical" className="h-4" />
              <span aria-label="Instruments online">
                <span className="text-muted-foreground">Online</span>{' '}
                <span className="tabular-nums">
                  {summaryMetrics.instrumentsOnline}/
                  {summaryMetrics.instrumentsTotal}
                </span>
              </span>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="w-72 overflow-auto border-r border-border/60">
                <RunQueue
                  runs={filteredRuns}
                  instruments={instruments}
                  selectedRunId={selectedRunId}
                  onSelectRun={setSelectedRunId}
                />
              </div>
              <div className="flex-1 overflow-auto">
                <RunDetail
                  run={selectedRun}
                  instrument={selectedInstrument}
                  stages={stagesQuery.data ?? []}
                  observations={observationsQuery.data ?? []}
                  plateSnapshots={snapshotsQuery.data ?? []}
                  timeZone={VIEW_TIMEZONE}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
