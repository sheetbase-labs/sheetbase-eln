/**
 * AUTO-03 — pipeline_output notebook block preview: references a Pipeline
 * run and links to its produced Dataset Version.
 */
import { Link } from '@tanstack/react-router'
import { Workflow } from 'lucide-react'

import { Badge } from '#/components/v3/ui/badge'

export interface PipelineOutputBlockPayload {
  /** The Pipeline run this block references (stable identity). */
  runId?: string
  /** Produced Dataset Version identity for display. */
  datasetId?: string
  datasetVersionId?: string
  label?: string
}

export function PipelineOutputBlockPreview({ payload }: { payload: unknown }) {
  const obj =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  if (!obj) return null
  const runId = typeof obj.runId === 'string' ? obj.runId : null
  const datasetId = typeof obj.datasetId === 'string' ? obj.datasetId : null
  const datasetVersionId =
    typeof obj.datasetVersionId === 'string' ? obj.datasetVersionId : null
  const label = typeof obj.label === 'string' ? obj.label : null

  if (!runId) {
    return (
      <div className="text-fg-muted flex items-center gap-2 rounded-md border p-3 text-sm">
        <Workflow className="size-4" aria-hidden="true" />
        Pipeline output block — attach a Pipeline run to pin its output here.
      </div>
    )
  }

  return (
    <div className="border-border flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-2">
        <Workflow className="text-primary size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {label ?? 'Pipeline run output'}
          </p>
          <p className="text-fg-muted font-mono text-xs">
            run {runId.slice(0, 8)}
            {datasetVersionId
              ? ` · Dataset Version ${datasetVersionId.slice(0, 8)}`
              : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="kind">Pipeline</Badge>
        <Link
          to="/pipelines/runs/$runId"
          params={{ runId }}
          className="text-primary text-xs underline-offset-2 hover:underline"
        >
          Inspect run
        </Link>
        {datasetId ? (
          <Link
            to="/datasets"
            search={{ dataset: datasetId, archived: false }}
            className="text-fg-muted text-xs underline-offset-2 hover:underline"
          >
            Output Dataset
          </Link>
        ) : null}
      </div>
    </div>
  )
}
