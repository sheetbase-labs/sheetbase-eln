/**
 * AUTO-03 — pipeline_output notebook block preview: references a Pipeline
 * run and links to its produced Dataset Version.
 *
 * PIPE-03 — when the block is linked to a proposal (`proposalId`) the block
 * renders that proposal in place. The preview is a read-only rendering (it is
 * used in the reader, print and submit views, and cannot tell a signed
 * notebook from a draft), so it shows Compare and a route to the decision
 * surface and never posts a decision itself.
 */
import { Link } from '@tanstack/react-router'
import { Icon } from '#/components/icons'

import { Badge } from '#/components/v3/ui/badge'
import {
  PipelineProposalAbsent,
  PipelineProposalBlock,
  PipelineProposalUnreadable,
  usePipelineProposalQuery,
} from './pipeline-output-block-proposal'

export interface PipelineOutputBlockPayload {
  /** The Pipeline run this block references (stable identity). */
  runId?: string
  /** Produced Dataset Version identity for display. */
  datasetId?: string
  datasetVersionId?: string
  label?: string
  /**
   * PIPE-03: the agent-operation proposal this block renders. Absent until a
   * run's propose-mode action pins one here, so the block states that rather
   * than showing inert Accept/Reject controls.
   */
  proposalId?: string
}

export function PipelineOutputBlockPreview({ payload }: { payload: unknown }) {
  const obj =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  const proposalId =
    obj && typeof obj.proposalId === 'string' ? obj.proposalId : null
  const proposalQuery = usePipelineProposalQuery(proposalId)
  const proposal = proposalQuery.data ?? null
  if (!obj) return null
  const runId = typeof obj.runId === 'string' ? obj.runId : null
  const datasetId = typeof obj.datasetId === 'string' ? obj.datasetId : null
  const datasetVersionId =
    typeof obj.datasetVersionId === 'string' ? obj.datasetVersionId : null
  const label = typeof obj.label === 'string' ? obj.label : null
  const currentOutput = runId
    ? `run ${runId.slice(0, 8)}${label ? ` — ${label}` : ''}`
    : null

  const proposalSection = proposal ? (
    <PipelineProposalBlock
      proposal={proposal}
      runId={runId ?? proposal.preview.target.id}
      currentOutput={currentOutput}
      readOnly
    />
  ) : proposalId && proposalQuery.isPending ? (
    <p className="text-fg-muted text-xs" role="status">
      Loading the linked proposal…
    </p>
  ) : proposalId ? (
    <PipelineProposalUnreadable />
  ) : (
    <PipelineProposalAbsent />
  )

  if (!runId) {
    return (
      <div className="space-y-2">
        <div className="text-fg-muted flex items-center gap-2 rounded-md border p-3 text-sm">
          <Icon name="pipeline" className="size-4" aria-hidden="true" />
          Attach a pipeline run to show its output here.
        </div>
        {proposalSection}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="border-border flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            name="pipeline"
            className="text-primary size-4 shrink-0"
            aria-hidden="true"
          />
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
            className="text-primary-text text-xs underline-offset-2 hover:underline"
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
      {proposalSection}
    </div>
  )
}
