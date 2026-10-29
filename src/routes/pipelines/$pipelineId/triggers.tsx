import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
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
  PipelineDefinitionVersionWire,
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
  draftVersion,
  declaredRunInputs,
} from '#/components/v3/pipelines/pipelines-data'
import {
  ElnActions,
  RunKeeps,
  RunNotifications,
  WebhookCard,
} from '#/components/v3/pipelines/triggers-outputs'
import type { PipelineConfig } from '#/lib/pipelines/config'
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

function WebhookSection({ definitionId }: { definitionId: string }) {
  return (
    <Section title={t('data.pipelineTriggers.webhook')} className="mt-6">
      <WebhookCard definitionId={definitionId} />
    </Section>
  )
}

/** What the version being worked on does with its results: where they go, the
 * ELN actions it takes and who it tells. */
function OutputsSection({
  pipelineId,
  version,
}: {
  pipelineId: string
  version: PipelineDefinitionVersionWire | undefined
}) {
  if (!version) return null
  const config = version.configuration as Partial<PipelineConfig>
  return (
    <Section
      title={t('data.pipelineTriggers.whatRunKeeps')}
      className="mt-6"
      action={
        <Muted>
          {version.lifecycle === 'draft'
            ? t('data.pipelineTriggers.draft')
            : t('data.pipelineTriggers.published')}{' '}
          v{version.version}
        </Muted>
      }
    >
      <RunKeeps config={config} pipelineId={pipelineId} />
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ElnActions config={config} />
        <RunNotifications config={config} />
      </div>
    </Section>
  )
}

const NEVER_ALLOWED = [
  t('data.pipelineTriggers.signApproveSubmitRecords'),
  t('data.pipelineTriggers.deleteOverwriteData'),
  t('data.pipelineTriggers.changeOwnPermissions'),
]

/** What a triggered run can and cannot do, which is the same however it was
 * started: it acts as the pipeline's own identity, proposes rather than
 * signs, and its Python steps run isolated from the database. */
function RunBoundaries() {
  return (
    <div className="mt-6 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
      <div>
        <h3 className="text-caption font-medium text-fg">
          {t('data.pipelineTriggers.runsAs')}
        </h3>
        <Muted>{t('data.pipelineTriggers.pipelineItselfEveryChange')}</Muted>
        <h3 className="mt-3 text-caption font-medium text-fg">
          {t('data.pipelineTriggers.pythonSteps')}
        </h3>
        <Muted>{t('data.pipelineTriggers.runIsolationTheyOnly')}</Muted>
      </div>
      <div>
        <h3 className="text-caption font-medium text-fg">
          {t('data.pipelineTriggers.neverAllowed')}
        </h3>
        <ul className="mt-1 list-disc pl-4 text-caption text-fg-muted">
          {NEVER_ALLOWED.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
        <Muted className="mt-2">
          {t('data.pipelineTriggers.triggersStartRunsThey')}
        </Muted>
      </div>
    </div>
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
  const shownVersion = versions.data
    ? (draftVersion(versions.data) ?? declaredVersion)
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
      toast(
        updated.enabled
          ? t('data.pipelineTriggers.triggerResumed')
          : t('data.pipelineTriggers.triggerPaused'),
        {
          description: updated.enabled
            ? t('data.pipelineTriggers.carriesFromNow')
            : t('data.pipelineTriggers.startsRunsUntilResume'),
        },
      )
    },
    onError: (error: unknown) =>
      toast(t('data.pipelineTriggers.couldChangeTrigger'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.pipelineTriggers.databaseRefused'),
      }),
  })

  const remove = useMutation({
    mutationFn: (scheduleId: string) =>
      deletePipelineSchedule(notebookDataClient, { workspaceId, scheduleId }),
    onSuccess: () => {
      void invalidate()
      toast(t('data.pipelineTriggers.triggerDeleted'))
    },
    onError: (error: unknown) =>
      toast(t('data.pipelineTriggers.couldDeleteTrigger'), {
        description:
          error instanceof Error
            ? error.message
            : t('data.pipelineTriggers.databaseRefused'),
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
      header: t('data.pipelineTriggers.trigger'),
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
              <span className="block text-fg-muted">
                {t('data.pipelineTriggers.with')} {passed}
              </span>
            ) : null}
            {row.original.spec.missedRunPolicy === 'skip' ? (
              <span className="block text-fg-muted">
                {row.original.kind === 'event'
                  ? t('data.pipelineTriggers.ignoresEventsWhilePaused')
                  : t('data.pipelineTriggers.skipsRunsMisses')}
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: t('data.pipelineTriggers.status'),
      cell: ({ row }) => (
        <Status tone={row.original.enabled ? 'ok' : 'stored'}>
          {row.original.enabled
            ? t('data.pipelineTriggers.enabled')
            : t('data.pipelineTriggers.paused')}
        </Status>
      ),
    },
    {
      id: 'lastRun',
      header: t('data.pipelineTriggers.lastRun'),
      cell: ({ row }) => {
        const run = latestRuns.data?.get(row.original.id)
        if (!run)
          return (
            <span className="text-fg-muted">
              {t('data.pipelineTriggers.notYet')}
            </span>
          )
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
      header: t('data.pipelineTriggers.nextRun'),
      cell: ({ row }) => {
        const next = row.original.next_run_at
        if (!row.original.enabled) {
          return (
            <span className="text-fg-muted">
              {t('data.pipelineTriggers.paused')}
            </span>
          )
        }
        if (hasPublishedVersion === false) {
          return (
            <span className="text-fg-muted">
              {t('data.pipelineTriggers.publishedVersion')}
            </span>
          )
        }
        if (row.original.kind === 'event') {
          return (
            <span className="text-fg-muted">
              {t('data.pipelineTriggers.onItsEvent')}
            </span>
          )
        }
        if (!next)
          return (
            <span className="text-fg-muted">
              {t('data.pipelineTriggers.neverFires')}
            </span>
          )
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
      header: () => (
        <span className="sr-only">{t('data.pipelineTriggers.actions')}</span>
      ),
      cell: ({ row }) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" onClick={() => setHistory(row.original)}>
            {t('data.pipelineTriggers.history')}
          </Button>
          <Button size="sm" onClick={() => setEditing(row.original)}>
            {t('common.actions.edit')}
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
            {row.original.enabled
              ? t('data.pipelineTriggers.pause')
              : t('data.pipelineTriggers.resume')}
          </Button>
          <ConfirmDialog>
            <ConfirmDialogTrigger>
              <Button size="sm" variant="quiet" disabled={remove.isPending}>
                {t('common.actions.delete')}
              </Button>
            </ConfirmDialogTrigger>
            <ConfirmDialogContent>
              <ConfirmDialogHeader>
                <ConfirmDialogTitle>
                  {t('data.pipelineTriggers.deleteTrigger')}
                </ConfirmDialogTitle>
                <ConfirmDialogDescription>
                  {t('data.pipelineTriggers.runsWouldHaveStarted')}
                </ConfirmDialogDescription>
              </ConfirmDialogHeader>
              <ConfirmDialogFooter>
                <ConfirmDialogCancel />
                <ConfirmDialogAction
                  variant="danger-fill"
                  onClick={() => remove.mutate(row.original.id)}
                >
                  {t('data.pipelineTriggers.deleteTrigger2')}
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
      {t('data.pipelineTriggers.newTrigger')}
    </Button>
  )

  if (schedules.isLoading || schedules.isError) {
    return (
      <div className="px-4 py-4 md:px-6">
        {schedules.isError ? (
          <ProjectListFailure
            error={schedules.error}
            what="pipeline triggers"
            onRetry={() => void schedules.refetch()}
          />
        ) : (
          <Muted>{t('data.pipelineTriggers.loadingTriggers')}</Muted>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <Section
        title={t('data.pipelineTriggers.startsOn')}
        count={rows.length}
        action={rows.length ? addButton : undefined}
      >
        <Muted>{t('data.pipelineTriggers.manualEditorsPipelinePress')}</Muted>
        {uninterpretable.length ? (
          <Notice tone="warn">
            {t('data.pipelineTriggers.triggersStoredSpecificationsCannot', {
              count: uninterpretable.length,
            })}
          </Notice>
        ) : null}
        {hasPublishedVersion === false ? (
          <Notice tone="warn">
            {t('data.pipelineTriggers.pipelineHasPublishedVersion')}{' '}
            <Link
              to="/pipelines/$pipelineId/steps"
              params={{ pipelineId }}
              className="text-link underline"
            >
              {t('data.pipelineTriggers.configurePublishVersionSteps')}
            </Link>
          </Notice>
        ) : null}
        {rows.length ? (
          <TableBox>
            <RegistryGrid
              label={t('data.pipelineTriggers.pipelineTriggers')}
              rows={rows}
              columns={columns}
              getRowId={(s) => s.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            title={t('data.pipelineTriggers.noTriggers')}
            description={t(
              'data.pipelineTriggers.triggersOptionalRunPublished',
            )}
            className="py-4"
            action={addButton}
          />
        )}
      </Section>
      <WebhookSection definitionId={pipelineId} />
      <OutputsSection pipelineId={pipelineId} version={shownVersion} />
      <RunBoundaries />
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
