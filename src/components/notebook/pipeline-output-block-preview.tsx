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
import { t } from '#/copy'
import { Link } from '@tanstack/react-router'
import { Icon } from '#/components/icons'

import { Badge } from '#/components/ui/badge'
import { pipelineOutputPayload } from './pipeline-output-payload'
import {
  PipelineProposalAbsent,
  PipelineProposalBlock,
  PipelineProposalUnreadable,
  usePipelineProposalQuery,
} from './pipeline-output-block-proposal'

export function PipelineOutputBlockPreview({ payload }: { payload: unknown }) {
  const parsed = pipelineOutputPayload.safeParse(payload)
  const obj = parsed.success ? parsed.data : null

  if (!obj) return null
  const { runId, datasetId, datasetVersionId, label } = obj

  const currentOutput = runId
    ? label
      ? t('notebook.pipelineOutputBlockPreview.runWithLabel', {
          id: runId.slice(0, 8),
          label,
        })
      : t('notebook.pipelineOutputBlockPreview.run', { id: runId.slice(0, 8) })
    : null

  const proposalSection = (
    <LinkedProposalPreview
      proposalId={obj.proposalId ?? null}
      runId={runId}
      currentOutput={currentOutput}
    />
  )

  if (!runId) {
    return (
      <div className="space-y-2">
        <div className="text-fg-muted flex items-center gap-2 rounded-md border p-3 text-sm">
          <Icon name="pipeline" className="size-4" aria-hidden="true" />
          {t('notebook.pipelineOutputBlockPreview.attachAPipelineRun')}
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
              {label ??
                t('notebook.pipelineOutputBlockPreview.pipelineRunOutput')}
            </p>
            <p className="text-fg-muted font-mono text-xs">
              run {runId.slice(0, 8)}
              {datasetVersionId
                ? t(
                    'notebook.pipelineOutputBlockPreview.datasetVersionDatasetversionid',
                    { datasetVersionId: datasetVersionId.slice(0, 8) },
                  )
                : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="kind">
            {t('notebook.pipelineOutputBlockPreview.pipeline')}
          </Badge>
          <Link
            to="/pipelines/runs/$runId"
            params={{ runId }}
            className="text-primary-text text-xs underline-offset-2 hover:underline"
          >
            {t('notebook.pipelineOutputBlockPreview.inspectRun')}
          </Link>
          {datasetId ? (
            <Link
              to="/datasets"
              search={{ dataset: datasetId, archived: false }}
              className="text-fg-muted text-xs underline-offset-2 hover:underline"
            >
              {t('notebook.pipelineOutputBlockPreview.outputDataset')}
            </Link>
          ) : null}
        </div>
      </div>
      {proposalSection}
    </div>
  )
}

/** Reader/print/submit never acquire proposal decision controls. */
function LinkedProposalPreview({
  proposalId,
  runId,
  currentOutput,
}: {
  proposalId: string | null
  runId: string | undefined
  currentOutput: string | null
}) {
  const proposalQuery = usePipelineProposalQuery(proposalId)
  const proposal = proposalQuery.data

  if (proposal)
    return (
      <PipelineProposalBlock
        proposal={proposal}
        runId={runId ?? proposal.preview.target.id}
        currentOutput={currentOutput}
        readOnly
      />
    )

  if (!proposalId) return <PipelineProposalAbsent />

  if (proposalQuery.isPending)
    return (
      <p className="text-fg-muted text-xs" role="status">
        {t('notebook.pipelineOutputBlockPreview.loadingTheLinkedProposal')}
      </p>
    )

  return <PipelineProposalUnreadable />
}
