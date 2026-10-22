import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Muted, Section } from '#/components/v3/ui/layout'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from '#/components/v3/ui/confirm-dialog'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { toast } from '#/components/v3/ui/sonner'
import {
  deletePipelineSchedule,
  updatePipelineSchedule,
} from '#/lib/pipelines/data'
import type {
  PipelineScheduleKind,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'
import {
  describeInputs,
  describeParameters,
  describeSchedule,
  relativeTime,
} from '#/lib/pipeline-schedule-form'
import { formatNotebookDateTime, notebookDataClient } from '#/lib/notebook-data'
import {
  pipelineDataQueryKeys,
  runStatus,
  usePipelineVersions,
  useLatestScheduleRuns,
  useSchedules,
  currentVersion,
  declaredRunInputs,
} from '#/components/v3/pipelines/pipelines-data'
import { ScheduleDialog } from '#/components/v3/pipelines/schedule-dialog'
import { ScheduleHistoryDialog } from '#/components/v3/pipelines/schedule-history'

/** UI port (roadmap-4/ui-app3): pipeline triggers. A trigger starts runs of
 * the published version on a schedule or when something happens. It can be
 * added, edited, paused, resumed and deleted, and each one shows when it last
 * ran, when it runs next and, in its history, why it did not run. */
export const Route = createFileRoute('/pipelines/$pipelineId/triggers')({
  component: PipelineTriggers,
})

/** The stored spec in the words a scientist uses: an interval, a time of day
 * in its zone, a weekday or monthly rule, or the event with its Dataset
 * filter. A spec this build cannot read renders as a gap, never raw jsonb. */
export function scheduleSpecLabel(
  kind: PipelineScheduleKind,
  spec: Record<string, unknown>,
  datasetNames: Map<string, string>,
): string {
  return describeSchedule(kind, spec, datasetNames)
}

/** The parameter values a trigger passes to every run it starts, as
 * `name=value` pairs, or an empty string when it passes none. */
export function scheduleParametersLabel(spec: Record<string, unknown>): string {
  return describeParameters(spec)
}

/** Dataset id → name, for the Datasets a trigger names. Only read when a
 * caller actually has an id to resolve. */
function useDatasetNames(enabled: boolean) {
  const query = useQuery({
    queryKey: ['ui-port', 'pipelines', 'trigger-datasets'],
    enabled,
    queryFn: async (): Promise<Map<string, string>> => {
      const rows = await notebookDataClient.list<{ id: string; name: string }>(
        'datasets',
        '?select=id,name&order=name.asc',
      )
      return new Map(rows.map((row) => [row.id, row.name]))
    },
    staleTime: 60_000,
  })
  return query.data ?? new Map<string, string>()
}

function namesDatasets(spec: Record<string, unknown>): boolean {
  if (typeof spec.datasetId === 'string') return true
  const inputs = spec.inputs
  return (
    !!inputs &&
    typeof inputs === 'object' &&
    Object.values(inputs).some(
      (binding) =>
        !!binding &&
        typeof binding === 'object' &&
        typeof (binding as { datasetId?: unknown }).datasetId === 'string',
    )
  )
}

function PipelineTriggers() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()
  const schedules = useSchedules(pipelineId)
  const rows = schedules.data ?? []
  const datasetNames = useDatasetNames(rows.some((s) => namesDatasets(s.spec)))
  const latestRuns = useLatestScheduleRuns(rows.map((s) => s.id))
  const [editing, setEditing] = useState<PipelineScheduleWire | null>(null)
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState<PipelineScheduleWire | null>(null)
  // The sweep starts a triggered run on the latest PUBLISHED version, so a
  // trigger on a pipeline that has none is enabled but cannot fire. The row
  // must not keep advertising a next run in that state; `null` means the
  // answer is not known yet, so no inert claim is made while it loads.
  const versions = usePipelineVersions(pipelineId)
  const hasPublishedVersion = versions.isSuccess
    ? versions.data.some((v) => v.lifecycle === 'published')
    : null

  const declaredVersion = versions.data
    ? currentVersion(versions.data)
    : undefined
  const declared = declaredVersion
    ? declaredRunInputs(declaredVersion)
    : { inputs: [], parameters: [] }

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: pipelineDataQueryKeys.schedules(pipelineId),
    })

  const toggle = useMutation({
    mutationFn: (input: { scheduleId: string; enabled: boolean }) =>
      updatePipelineSchedule(notebookDataClient, {
        workspaceId,
        scheduleId: input.scheduleId,
        enabled: input.enabled,
      }),
    onSuccess: (updated) => {
      void invalidate()
      toast(updated.enabled ? 'Trigger resumed' : 'Trigger paused', {
        description: updated.enabled
          ? 'It carries on from now.'
          : 'It starts no runs until you resume it.',
      })
    },
    onError: (error: unknown) =>
      toast('Could not change the trigger', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const remove = useMutation({
    mutationFn: (scheduleId: string) =>
      deletePipelineSchedule(notebookDataClient, { workspaceId, scheduleId }),
    onSuccess: () => {
      void invalidate()
      toast('Trigger deleted')
    },
    onError: (error: unknown) =>
      toast('Could not delete the trigger', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  // A timed trigger whose stored spec this build cannot read has no next run:
  // nothing will schedule it, so the page says so rather than leaving a blank.
  const uninterpretable = rows.filter(
    (s) =>
      s.kind !== 'event' &&
      !s.next_run_at &&
      scheduleSpecLabel(s.kind, s.spec, datasetNames) === '—',
  )

  const columns: RegistryColumn<(typeof rows)[number]>[] = [
    {
      id: 'spec',
      header: 'Trigger',
      cell: ({ row }) => {
        const passed = scheduleParametersLabel(row.original.spec)
        const reads = describeInputs(row.original.spec, datasetNames)
        return (
          <span className="text-caption">
            {scheduleSpecLabel(
              row.original.kind,
              row.original.spec,
              datasetNames,
            )}
            {reads.map((line) => (
              <span key={line} className="block text-fg-muted">
                {line}
              </span>
            ))}
            {passed ? (
              <span className="block text-fg-muted">With {passed}</span>
            ) : null}
            {row.original.spec.missedRunPolicy === 'skip' ? (
              <span className="block text-fg-muted">
                {row.original.kind === 'event'
                  ? 'Ignores events while paused'
                  : 'Skips runs it misses'}
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Status tone={row.original.enabled ? 'ok' : 'stored'}>
          {row.original.enabled ? 'Enabled' : 'Paused'}
        </Status>
      ),
    },
    {
      id: 'lastRun',
      header: 'Last run',
      cell: ({ row }) => {
        const run = latestRuns.data?.get(row.original.id)
        if (!run) return <span className="text-fg-muted">Not yet</span>
        const status = runStatus(run.status)
        return (
          <span className="flex flex-col gap-0.5">
            <Status tone={status.tone}>{status.label}</Status>
            <Link
              to="/pipelines/runs/$runId"
              params={{ runId: run.id }}
              className="text-caption text-accent hover:underline"
            >
              {formatNotebookDateTime(run.started_at, { zone: true })}
            </Link>
          </span>
        )
      },
    },
    {
      id: 'nextRun',
      header: 'Next run',
      cell: ({ row }) => {
        const next = row.original.next_run_at
        if (!row.original.enabled) {
          return <span className="text-fg-muted">Paused</span>
        }
        if (hasPublishedVersion === false) {
          return <span className="text-fg-muted">No published version</span>
        }
        if (row.original.kind === 'event') {
          return <span className="text-fg-muted">On its event</span>
        }
        if (!next) return <span className="text-fg-muted">Never fires</span>
        return (
          <span className="flex flex-col gap-0.5">
            <span>{formatNotebookDateTime(next, { zone: true })}</span>
            <span className="text-caption text-fg-muted">
              {relativeTime(next)}
            </span>
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" onClick={() => setHistory(row.original)}>
            History
          </Button>
          <Button size="sm" onClick={() => setEditing(row.original)}>
            Edit
          </Button>
          <Button
            size="sm"
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate({
                scheduleId: row.original.id,
                enabled: !row.original.enabled,
              })
            }
          >
            {row.original.enabled ? 'Pause' : 'Resume'}
          </Button>
          <ConfirmDialog>
            <ConfirmDialogTrigger>
              <Button size="sm" variant="quiet" disabled={remove.isPending}>
                Delete
              </Button>
            </ConfirmDialogTrigger>
            <ConfirmDialogContent>
              <ConfirmDialogHeader>
                <ConfirmDialogTitle>Delete this trigger?</ConfirmDialogTitle>
                <ConfirmDialogDescription>
                  Runs it would have started will not happen, and deleting
                  cannot be undone. Its run history stays with the runs. Add a
                  new trigger if the pipeline should still run on a schedule or
                  an event.
                </ConfirmDialogDescription>
              </ConfirmDialogHeader>
              <ConfirmDialogFooter>
                <ConfirmDialogCancel />
                <ConfirmDialogAction
                  variant="danger-fill"
                  onClick={() => remove.mutate(row.original.id)}
                >
                  Delete trigger
                </ConfirmDialogAction>
              </ConfirmDialogFooter>
            </ConfirmDialogContent>
          </ConfirmDialog>
        </div>
      ),
      meta: rightAligned<(typeof rows)[number]>().meta,
    },
  ]

  const addButton = (
    <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
      New trigger
    </Button>
  )

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <Section title="Triggers" count={rows.length} action={addButton}>
        {uninterpretable.length ? (
          <Notice tone="warn">
            {uninterpretable.length === 1
              ? '1 trigger’s stored specification cannot be interpreted, so it has no next run and will not fire. Delete it and add a new trigger to restore the schedule.'
              : `${uninterpretable.length} triggers’ stored specifications cannot be interpreted, so they have no next run and will not fire. Delete them and add new triggers to restore the schedules.`}
          </Notice>
        ) : null}
        {hasPublishedVersion === false && rows.length ? (
          <Notice tone="warn">
            This pipeline has no published version, so its triggers will not
            fire. Publish a version to activate them.
          </Notice>
        ) : null}
        {rows.length ? (
          <TableBox>
            <RegistryGrid
              label="Pipeline triggers"
              rows={rows}
              columns={columns}
              getRowId={(s) => s.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            icon="calendar"
            title="No triggers"
            description="A pipeline runs when someone presses Run now until a trigger is added."
            className="py-4"
            action={addButton}
          />
        )}
      </Section>
      <Muted className="mt-4">
        Triggers start runs; they never sign, submit, approve or delete.
      </Muted>
      <ScheduleDialog
        open={adding}
        onOpenChange={setAdding}
        definitionId={pipelineId}
        workspaceId={workspaceId}
        inputs={declared.inputs}
        parameters={declared.parameters}
      />
      {editing ? (
        <ScheduleDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          schedule={editing}
          definitionId={pipelineId}
          workspaceId={workspaceId}
          inputs={declared.inputs}
          parameters={declared.parameters}
        />
      ) : null}
      {history ? (
        <ScheduleHistoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setHistory(null)
          }}
          schedule={history}
          title={scheduleSpecLabel(history.kind, history.spec, datasetNames)}
        />
      ) : null}
    </div>
  )
}
