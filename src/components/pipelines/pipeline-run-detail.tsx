/**
 * AUTO-03 — Pipeline run detail: status, inputs, outputs and the append-only
 * stage log. Outputs link to the canonical Dataset Versions the run produced.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import {
  Badge,
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
  })
  const logsQuery = useQuery({
    queryKey: pipelineQueryKeys.runLogs(runId),
    queryFn: () => listPipelineRunLogs(dataClient, runId),
    enabled: Boolean(runId),
  })
  const outputsQuery = useQuery({
    queryKey: pipelineQueryKeys.runOutputs(runId),
    queryFn: () => listPipelineRunOutputs(dataClient, runId),
    enabled: Boolean(runId),
  })

  const run = runQuery.data

  if (runQuery.isLoading) return <Skeleton className="h-40" />
  if (!run) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Pipeline run not found.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
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
            <CardTitle className="text-sm">Outputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {outputsQuery.data?.length ? (
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
                No outputs were recorded for this run.
              </span>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Stage log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {logsQuery.data?.length ? (
            logsQuery.data.map((log) => (
              <div
                key={log.id}
                className="grid grid-cols-[5rem_6rem_1fr] gap-2 border-b py-1.5 text-xs last:border-0"
              >
                <span className="text-muted-foreground">
                  {formatRelativeTime(log.at)}
                </span>
                <span
                  className={
                    log.level === 'error'
                      ? 'text-destructive font-mono'
                      : log.level === 'warning'
                        ? 'text-amber-600 font-mono'
                        : 'font-mono'
                  }
                >
                  {log.stage}
                </span>
                <span className="truncate">{log.message}</span>
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
