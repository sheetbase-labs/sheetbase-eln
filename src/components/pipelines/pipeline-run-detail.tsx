/**
 * AUTO-03 — Pipeline run detail: status, inputs, outputs and the append-only
 * stage log. Outputs link to the canonical Dataset Versions the run produced.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import {
  getPipelineRun,
  listPipelineRunLogs,
  listPipelineRunOutputs,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import type { PipelineRunLogWire } from '#/lib/pipelines/types'
import { formatRelativeTime } from '#/lib/notebook-data'

export function PipelineRunDetail({
  dataClient,
  runId,
}: {
  dataClient: DataClient
  runId: string
}) {
  const runQuery = useQuery({
    queryKey: pipelineQueryKeys.run(runId),
    queryFn: () => getPipelineRun(dataClient, runId),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 3000 : false,
  })
  const logsQuery = useQuery({
    queryKey: pipelineQueryKeys.runLogs(runId),
    queryFn: () => listPipelineRunLogs(dataClient, runId),
    enabled: Boolean(runId),
    refetchInterval: runQuery.data?.status === 'running' ? 3000 : false,
  })
  const outputsQuery = useQuery({
    queryKey: pipelineQueryKeys.runOutputs(runId),
    queryFn: () => listPipelineRunOutputs(dataClient, runId),
    enabled: Boolean(runId),
    refetchInterval: runQuery.data?.status === 'running' ? 3000 : false,
  })

  const run = runQuery.data

  if (runQuery.isLoading) return <Skeleton className="h-40" />
  if (runQuery.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load this run.{' '}
        <Button size="sm" variant="link" onClick={() => runQuery.refetch()}>
          Retry
        </Button>
      </p>
    )
  if (!run) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Pipeline run not found.
      </p>
    )
  }

  const deliveryIds = Array.isArray(run.result.notificationDeliveryIds)
    ? run.result.notificationDeliveryIds.filter(
        (id): id is string => typeof id === 'string',
      )
    : []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant={
            run.status === 'failed'
              ? 'danger'
              : run.status === 'running'
                ? 'default'
                : 'secondary'
          }
        >
          {run.status}
        </Badge>
        {run.error_code && (
          <span className="text-muted-foreground font-mono text-xs">
            {run.error_code}
          </span>
        )}
        <span className="text-muted-foreground text-sm">
          {run.trigger_kind} · attempt {run.attempt} · started{' '}
          {formatRelativeTime(run.started_at)}
        </span>
      </div>

      {run.error_message && (
        <p
          role="alert"
          className="text-destructive rounded-md border p-3 text-sm"
        >
          {run.error_message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(run.input_versions).map(([name, versionId]) => (
              <div
                key={name}
                className="flex items-center justify-between gap-2"
              >
                <span className="font-mono text-xs">{name}</span>
                <span className="font-mono text-xs">{shortId(versionId)}</span>
              </div>
            ))}
            {Object.keys(run.input_versions).length === 0 && (
              <span className="text-muted-foreground text-xs">
                No inputs recorded.
              </span>
            )}
            {Object.keys(run.parameters).length > 0 && (
              <div className="text-muted-foreground space-y-1 border-t pt-2 text-xs">
                {Object.entries(run.parameters).map(([name, value]) => (
                  <div key={name} className="flex justify-between">
                    <span className="font-mono">{name}</span>
                    <span className="font-mono">{String(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Dataset outputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {outputsQuery.isError ? (
              <p role="alert" className="text-xs text-destructive">
                Could not load outputs.
              </p>
            ) : outputsQuery.isLoading ? (
              <p role="status" className="text-xs text-muted-foreground">
                Loading outputs…
              </p>
            ) : outputsQuery.data?.length ? (
              outputsQuery.data.map((output) => (
                <div key={output.id} className="flex flex-col gap-0.5">
                  <Link
                    to="/datasets"
                    search={{ dataset: output.dataset_id, archived: false }}
                    className="text-primary text-xs underline-offset-2 hover:underline"
                  >
                    {output.label} — Dataset {shortId(output.dataset_id)}
                  </Link>
                  <span className="text-muted-foreground font-mono text-xs">
                    version {shortId(output.dataset_version_id)}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-muted-foreground text-xs">
                No dataset output recorded.
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      <PipelineActionResults
        actions={run.result.actions}
        logs={logsQuery.data ?? []}
      />
      {deliveryIds.length > 0 && (
        <section className="space-y-1 border-y py-3" aria-label="Notifications">
          <p className="text-sm font-medium">
            {deliveryIds.length}{' '}
            {deliveryIds.length === 1 ? 'notification' : 'notifications'} queued
          </p>
          <p className="text-xs text-muted-foreground">
            Delivery is tracked separately from this run.{' '}
            <Link
              to="/admin/$section"
              params={{ section: 'webhooks' }}
              search={{ model: undefined }}
              className="text-primary underline-offset-2 hover:underline"
            >
              View webhook deliveries
            </Link>
          </p>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Stage log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {logsQuery.isError ? (
            <p role="alert" className="text-xs text-destructive">
              Could not load the stage log.
            </p>
          ) : logsQuery.isLoading ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading stage log…
            </p>
          ) : logsQuery.data?.length ? (
            logsQuery.data.map((log) => (
              <div
                key={log.id}
                className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 border-b py-2 text-xs last:border-0 sm:grid-cols-[5rem_8rem_minmax(0,1fr)]"
              >
                <span className="text-muted-foreground">
                  {formatRelativeTime(log.at)}
                </span>
                <span
                  className={
                    log.level === 'error'
                      ? 'text-destructive font-mono'
                      : log.level === 'warning'
                        ? 'text-warning-text font-mono'
                        : 'font-mono'
                  }
                >
                  {log.stage}
                </span>
                <div className="col-span-2 min-w-0 space-y-2 sm:col-span-1">
                  <p className="whitespace-pre-wrap break-words">
                    {log.message}
                  </p>
                  <PipelineLogDetails detail={log.detail} />
                </div>
              </div>
            ))
          ) : (
            <span className="text-muted-foreground text-xs">
              No stage logs yet.
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

export function PipelineActionResults({
  actions,
  logs,
}: {
  actions: unknown
  logs: PipelineRunLogWire[]
}) {
  if (!isObject(actions) || Object.keys(actions).length === 0) return null
  return (
    <section className="space-y-2" aria-labelledby="pipeline-action-results">
      <h3 id="pipeline-action-results" className="text-sm font-medium">
        ELN action results
      </h3>
      <div className="divide-y border-y">
        {Object.entries(actions).map(([name, result]) => {
          const row = isObject(result) ? result : null
          const record = row && isObject(row.record) ? row.record : row
          const operation = logs.find(
            (log) =>
              log.detail.name === name &&
              typeof log.detail.operation === 'string',
          )?.detail.operation
          // A bare id is not enough to identify an entity. Only link canonical
          // record rows, or the confirmed create_project operation's project row.
          const recordId =
            record &&
            isId(record.id) &&
            typeof record.kind === 'string' &&
            typeof record.project_id === 'string'
              ? record.id
              : null
          const projectId =
            operation === 'create_project' && row && isId(row.id)
              ? row.id
              : null
          const label =
            record &&
            [record.title, record.name, record.identifier].find(
              (value) => typeof value === 'string' && value.length > 0,
            )
          const title = typeof label === 'string' ? label : name
          const identifier =
            record && typeof record.identifier === 'string'
              ? record.identifier
              : null
          return (
            <div key={name} className="space-y-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {name}
                </span>
                {identifier && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {identifier}
                  </span>
                )}
              </div>
              <div className="break-words text-sm">
                {recordId ? (
                  <Link
                    to="/records/$recordId"
                    params={{ recordId }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {title}
                  </Link>
                ) : projectId ? (
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId }}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {title}
                  </Link>
                ) : (
                  <span>{title}</span>
                )}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                  Result details
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function PipelineLogDetails({
  detail,
}: {
  detail: Record<string, unknown>
}) {
  const logs = Array.isArray(detail.logs)
    ? detail.logs.filter((entry): entry is string => typeof entry === 'string')
    : []
  const runtime = typeof detail.runtime === 'string' ? detail.runtime : null
  if (logs.length === 0 && !runtime) return null
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground">
        {logs.length > 0 ? 'Python output' : 'Runtime details'}
      </summary>
      {runtime && (
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          {runtime}
        </p>
      )}
      {logs.length > 0 && (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3">
          {logs.join('\n')}
        </pre>
      )}
    </details>
  )
}
