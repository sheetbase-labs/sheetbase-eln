/**
 * AUTO-03 — Pipeline run history for a definition version: status, trigger,
 * attempt lineage, idempotent re-runs, retry and cancel.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Loader2, Play, RotateCcw, XCircle } from 'lucide-react'

import {
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import type { PipelineConfig } from '#/lib/pipelines/config'
import type {
  PipelineDefinitionVersionWire,
  PipelineRunWire,
} from '#/lib/pipelines/types'
import {
  cancelPipelineRun,
  listPipelineRuns,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import { formatRelativeTime } from '#/lib/notebook-data'
import { RunPipelineDialog } from './run-pipeline-dialog'

const STATUS_VARIANT: Record<
  PipelineRunWire['status'],
  'default' | 'secondary' | 'danger' | 'outline'
> = {
  running: 'default',
  succeeded: 'secondary',
  failed: 'danger',
  cancelled: 'outline',
}

export function PipelineRunHistory({
  dataClient,
  workspaceId,
  version,
  config,
}: {
  dataClient: DataClient
  workspaceId: string
  version: PipelineDefinitionVersionWire
  config: PipelineConfig
}) {
  const queryClient = useQueryClient()
  const [runOpen, setRunOpen] = useState(false)
  const [retryRun, setRetryRun] = useState<PipelineRunWire | null>(null)
  const [justStarted, setJustStarted] = useState<PipelineRunWire | null>(null)

  const runsQuery = useQuery({
    queryKey: pipelineQueryKeys.runs(version.id),
    queryFn: () => listPipelineRuns(dataClient, version.id, 50),
    enabled: Boolean(workspaceId),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === 'running') ? 3000 : false,
  })

  const cancelMutation = useMutation({
    mutationFn: (runId: string) =>
      cancelPipelineRun(dataClient, { workspaceId, runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: pipelineQueryKeys.runs(version.id),
      })
    },
  })

  const runs = runsQuery.data ?? []

  const openRun = (retryOf: PipelineRunWire | null) => {
    setRetryRun(retryOf)
    setRunOpen(true)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          Run history — v{version.version}
        </h3>
        {version.lifecycle === 'published' && (
          <Button size="sm" onClick={() => openRun(null)}>
            <Play className="size-4" /> Run
          </Button>
        )}
      </div>

      {runsQuery.isLoading ? (
        <Skeleton className="h-24" />
      ) : runsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load runs.{' '}
          <Button variant="link" size="sm" onClick={() => runsQuery.refetch()}>
            Retry
          </Button>
        </p>
      ) : runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {version.lifecycle === 'published'
            ? 'No runs yet. Choose Run to supply any inputs and parameters, then start this version.'
            : 'No runs were recorded for this retired version.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Attempt</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Finished</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[run.status]}>
                    {run.status}
                  </Badge>
                  {run.error_code && (
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {run.error_code}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{run.trigger_kind}</TableCell>
                <TableCell className="text-sm">
                  {run.attempt}
                  {run.retry_of_run_id ? (
                    <span className="text-muted-foreground text-xs">
                      {' '}
                      (of {shortId(run.retry_of_run_id)})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">
                  {formatRelativeTime(run.started_at)}
                </TableCell>
                <TableCell className="text-sm">
                  {run.finished_at ? formatRelativeTime(run.finished_at) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to="/pipelines/runs/$runId"
                        params={{ runId: run.id }}
                      >
                        Inspect
                      </Link>
                    </Button>
                    {run.status === 'running' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancelMutation.mutate(run.id)}
                        disabled={cancelMutation.isPending}
                        aria-label="Cancel run"
                      >
                        {cancelMutation.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <XCircle className="size-4" />
                        )}
                      </Button>
                    )}
                    {run.status === 'failed' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openRun(run)}
                      >
                        <RotateCcw className="size-4" /> Retry
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {cancelMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not cancel the run. Try again.
        </p>
      )}
      {justStarted && (
        <p className="text-muted-foreground text-xs">
          Run {shortId(justStarted.id)} {justStarted.status}.{' '}
          <Link
            to="/pipelines/runs/$runId"
            params={{ runId: justStarted.id }}
            className="underline"
          >
            Inspect it
          </Link>
          .
        </p>
      )}

      <RunPipelineDialog
        dataClient={dataClient}
        workspaceId={workspaceId}
        definitionVersionId={version.id}
        config={config}
        open={runOpen}
        onOpenChange={setRunOpen}
        onRunStarted={setJustStarted}
        retryRun={retryRun}
      />
    </div>
  )
}

function shortId(id: string): string {
  return id.slice(0, 8)
}
