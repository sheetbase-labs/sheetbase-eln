/**
 * AUTO-03 — Dataset → Pipeline integration.
 *
 * The Dataset page's Pipelines tab lists every published single-input
 * Pipeline and lets a user run one against this Dataset: the run dialog is
 * pre-filled with the Dataset's latest Version id, so "run a compatible
 * Pipeline on this Dataset" is a first-class product path.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Play, Workflow } from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import { listDatasetVersions } from '#/lib/dataset-product'
import { validatePipelineConfig } from '#/lib/pipelines/config'
import type { PipelineConfig } from '#/lib/pipelines/config'
import {
  getPipelineDefinitionVersion,
  listRunCompatiblePipelines,
  pipelineQueryKeys,
} from '#/lib/pipelines/data'
import type { RunCompatiblePipeline } from '#/lib/pipelines/data'
import { RunPipelineDialog } from './run-pipeline-dialog'

export function PipelineDatasetTab({
  dataClient,
  workspaceId,
  datasetId,
}: {
  dataClient: DataClient
  workspaceId: string
  datasetId: string
}) {
  const pipelinesQuery = useQuery({
    queryKey: pipelineQueryKeys.definitions,
    queryFn: () => listRunCompatiblePipelines(dataClient),
    enabled: Boolean(workspaceId),
  })
  const versionsQuery = useQuery({
    queryKey: ['datasets', datasetId, 'versions'],
    queryFn: () => listDatasetVersions(dataClient, datasetId),
    enabled: Boolean(workspaceId),
  })

  const [runTarget, setRunTarget] = useState<RunCompatiblePipeline | null>(null)

  const pipelines = pipelinesQuery.data ?? []
  const latestVersionId = versionsQuery.data?.[0]?.id ?? null

  // Load the selected Pipeline version's real configuration so the run
  // dialog validates against the actual inputs/parameters.
  const targetConfigQuery = useQuery({
    queryKey: ['pipelines', 'version', runTarget?.versionId ?? ''],
    queryFn: () =>
      getPipelineDefinitionVersion(dataClient, runTarget!.versionId),
    enabled: Boolean(runTarget),
  })
  const targetConfig = useMemo(() => {
    const raw = targetConfigQuery.data?.configuration
    const errors = validatePipelineConfig(raw)
    return errors.length === 0 ? (raw as unknown as PipelineConfig) : null
  }, [targetConfigQuery.data])

  if (!latestVersionId) {
    return (
      <p className="text-muted-foreground text-sm">
        Snapshot a Dataset Version first — Pipelines run against pinned Dataset
        Versions, never a live Dataset.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Run a Pipeline on this Dataset</h3>
        <p className="text-muted-foreground text-xs">
          Single-input Pipelines run against this Dataset's latest Version (
          {latestVersionId.slice(0, 8)}). Add more Pipelines from the{' '}
          <Link to="/pipelines" className="underline underline-offset-2">
            Pipelines
          </Link>{' '}
          surface.
        </p>
      </div>

      {pipelines.length === 0 ? (
        <Empty>
          <EmptyIcon>
            <Workflow className="size-8" />
          </EmptyIcon>
          <EmptyTitle>No runnable Pipelines yet</EmptyTitle>
          <EmptyDescription>
            Publish a single-input Pipeline and it will appear here, ready to
            run against this Dataset.
          </EmptyDescription>
          <EmptyActions>
            <Button asChild variant="outline" size="sm">
              <Link to="/pipelines">Open Pipelines</Link>
            </Button>
          </EmptyActions>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {pipelines.map((pipeline) => (
            <Card key={pipeline.versionId}>
              <CardHeader>
                <CardTitle className="text-sm">
                  {pipeline.definitionName}
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  {pipeline.definitionKey} · v{pipeline.versionNumber}
                  {pipeline.hasParameters ? ' · has parameters' : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <Badge variant="secondary">{pipeline.inputName}</Badge>
                <Button size="sm" onClick={() => setRunTarget(pipeline)}>
                  <Play className="size-4" /> Run on latest Version
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {runTarget && targetConfig && (
        <RunPipelineDialog
          dataClient={dataClient}
          workspaceId={workspaceId}
          definitionVersionId={runTarget.versionId}
          config={targetConfig}
          open={Boolean(runTarget)}
          onOpenChange={(open) => {
            if (!open) setRunTarget(null)
          }}
          onRunStarted={() => setRunTarget(null)}
          initialInputVersions={{ [runTarget.inputName]: latestVersionId }}
        />
      )}
    </div>
  )
}
