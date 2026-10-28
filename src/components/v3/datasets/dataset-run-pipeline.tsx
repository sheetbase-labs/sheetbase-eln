import { useMemo } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { Button } from '#/components/v3/ui/button'
import {
  declaredRunInputs,
  usePipelineRows,
} from '#/components/v3/pipelines/pipelines-data'
import type { PipelineListRow } from '#/components/v3/pipelines/pipelines-data'
import { useRunLauncher } from '#/components/v3/pipelines/use-run-launcher'
import type { PipelineRunWire } from '#/lib/pipelines/types'

/** Pipelines that can start from a dataset: a live version that reads an input. */
export function pipelinesThatReadADataset(
  rows: PipelineListRow[],
): Array<
  PipelineListRow & { current: NonNullable<PipelineListRow['current']> }
> {
  return rows.flatMap((row) =>
    row.current &&
    row.current.lifecycle !== 'draft' &&
    declaredRunInputs(row.current).inputs.length > 0
      ? [{ ...row, current: row.current }]
      : [],
  )
}

/**
 * "Run pipeline…" on a dataset: pick a pipeline that reads a dataset and start
 * "Run with…" with its first input already pinned to this dataset's newest
 * snapshot. A run reads a saved Dataset Version, never live rows, so a dataset
 * with no snapshot is told to take one first. Renders nothing when no pipeline
 * reads a dataset, so the control never leads nowhere.
 */
export function useDatasetPipelineRuns({
  workspaceId,
  latestVersionId,
  onStarted,
}: {
  workspaceId: string
  latestVersionId: string | null
  onStarted?: (run: PipelineRunWire) => void
}) {
  const pipelines = usePipelineRows()
  const run = useRunLauncher(workspaceId, onStarted)
  const candidates = useMemo(
    () => pipelinesThatReadADataset(pipelines.data ?? []),
    [pipelines.data],
  )
  const start = (row: (typeof candidates)[number]) => {
    const input = declaredRunInputs(row.current).inputs.at(0)
    run.launch({
      pipelineName: row.name,
      version: row.current,
      initial:
        latestVersionId && input
          ? { inputVersions: { [input.name]: latestVersionId } }
          : undefined,
    })
  }
  return { candidates, start, pending: run.pending, dialog: run.dialog }
}

/**
 * The same choice as menu items, for a header that keeps its main actions as
 * buttons and puts the rest in one menu. The launcher's dialog is rendered by
 * the caller (`dialog` from the hook), outside the menu that opens it.
 */
export function DatasetPipelineMenuItems({
  runs,
  latestVersionId,
}: {
  runs: ReturnType<typeof useDatasetPipelineRuns>
  latestVersionId: string | null
}) {
  if (runs.candidates.length === 0) return null
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>
        {latestVersionId
          ? 'Run pipeline'
          : 'Run pipeline: take a snapshot first, a run reads a saved version.'}
      </DropdownMenuLabel>
      {runs.candidates.map((row) => (
        <DropdownMenuItem
          key={row.id}
          icon="play"
          disabled={!latestVersionId || runs.pending}
          hint={`v${row.current.version}`}
          onClick={() => runs.start(row)}
        >
          {row.name}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}

export function DatasetRunPipeline({
  workspaceId,
  latestVersionId,
  onStarted,
}: {
  workspaceId: string
  /** The dataset's newest Dataset Version, or null when it has none. */
  latestVersionId: string | null
  onStarted?: (run: PipelineRunWire) => void
}) {
  const run = useDatasetPipelineRuns({
    workspaceId,
    latestVersionId,
    onStarted,
  })
  const candidates = run.candidates
  if (candidates.length === 0) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button icon="play" disabled={run.pending}>
              Run pipeline…
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {/* The label has to live inside a group: Base UI's group label throws
              without one. */}
          {latestVersionId ? null : (
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                Take a snapshot first: a run reads a saved version.
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          )}
          {candidates.map((row) => (
            <DropdownMenuItem
              key={row.id}
              disabled={!latestVersionId}
              hint={`v${row.current.version}`}
              onClick={() => run.start(row)}
            >
              {row.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {run.dialog}
    </>
  )
}
