/**
 * PIPE-03 — pipeline proposal block (the "accept, compare, reject" block from
 * `canvas/Notebook.dc.html`).
 *
 * A run's propose-mode action writes an agent-operation proposal
 * (`api.agent_operation_proposals`, AUTO-04). This block renders that proposal
 * in place and wires the design's three actions to the authority that exists
 * today: `decide_agent_operation` for Accept/Reject and `execute_agent_operation`
 * for the explicit apply step a `human_required` policy needs.
 *
 * Honesty rules (the reason this file exists):
 *  - Absence is stated, never implied by an inert control. A block with no
 *    linked proposal says so.
 *  - A proposal that is already decided (`succeeded`, `rejected`, `failed`,
 *    `cancelled`) renders its terminal state with no Accept/Reject/Execute.
 *  - A read-only rendering (notebook preview, viewer, signed) shows Compare and
 *    a route to the decision surface; it never renders decision controls.
 *  - The RPC is authoritative: if the caller may not decide, the server refuses
 *    and the refusal is shown rather than hidden by UI gating.
 */
import { t } from '#/copy'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Field } from '#/components/v3/ui/input'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Textarea } from '#/components/v3/inventory/list'
import { Icon } from '#/components/v3/icons'
import { Notice } from '#/components/v3/ui/alert'
import { createDataClient } from '#/lib/data-client'
import {
  agentOperationLabel,
  agentOperationQueryKeys,
  fetchAgentOperationProposal,
} from '#/lib/agent-operations'
import type {
  AgentOperationProposal,
  AgentProposalStatus,
} from '#/lib/agent-operations'

const dataClient = createDataClient()

/** Shown where a block references a run but no proposal is pinned to it. */
export const PROPOSAL_ABSENT_MESSAGE = t(
  'notebook.pipelineOutputBlockProposal.noPipelineProposalIs',
)

/** Shown when a linked proposal exists but the caller cannot read the row. */
export const PROPOSAL_UNREADABLE_MESSAGE = t(
  'notebook.pipelineOutputBlockProposal.theLinkedPipelineProposal',
)

const STATUS_TONE: Record<AgentProposalStatus, Tone> = {
  pending: 'review',
  approved: 'progress',
  executing: 'progress',
  succeeded: 'ok',
  failed: 'bad',
  rejected: 'bad',
  cancelled: 'draft',
}

const STATUS_LABEL: Record<AgentProposalStatus, string> = {
  pending: t('notebook.pipelineOutputBlockProposal.awaitingADecision'),
  approved: t('notebook.pipelineOutputBlockProposal.approvedNotYetApplied'),
  executing: t('notebook.pipelineOutputBlockProposal.applying'),
  succeeded: t('notebook.pipelineOutputBlockProposal.applied'),
  failed: t('notebook.pipelineOutputBlockProposal.applicationFailed'),
  rejected: t('notebook.pipelineOutputBlockProposal.rejected'),
  cancelled: t('notebook.pipelineOutputBlockProposal.withdrawn'),
}

/**
 * Load one linked proposal. Mirrors `agentOperationQueryKeys.events`: the query
 * is keyed by id so a decision can write the RPC's returned row straight back
 * into the cache.
 */
export function usePipelineProposalQuery(proposalId: string | null) {
  return useQuery({
    queryKey: agentOperationQueryKeys.proposal(proposalId ?? ''),
    queryFn: () => fetchAgentOperationProposal(dataClient, proposalId ?? ''),
    enabled: Boolean(proposalId),
  })
}

function ValuePreview({ value }: { value: unknown }) {
  const text =
    value === undefined
      ? '—'
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)
  return (
    <code className="text-fg-muted max-w-full overflow-hidden text-ellipsis whitespace-pre-wrap break-all font-mono text-[11px]">
      {text && text.length > 400 ? `${text.slice(0, 400)}…` : text}
    </code>
  )
}

function ComparePanel({
  proposal,
  runId,
  currentOutput,
}: {
  proposal: AgentOperationProposal
  runId?: string | null
  currentOutput?: string | null
}) {
  const changes = proposal.preview.changes
  return (
    <div
      data-proposal-compare=""
      className="border-border space-y-2 rounded-md border p-3 text-xs"
    >
      <p className="font-medium">
        {t('notebook.pipelineOutputBlockProposal.proposedChangeVsThe')}
      </p>
      <dl className="text-fg-muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt>{t('notebook.pipelineOutputBlockProposal.thisBlockNow')}</dt>
        <dd>
          {currentOutput ??
            t('notebook.pipelineOutputBlockProposal.nothingLinkedYet')}
        </dd>
        <dt>{t('notebook.pipelineOutputBlockProposal.operation')}</dt>
        <dd>{agentOperationLabel(proposal.operation_kind)}</dd>
        <dt>{t('notebook.pipelineOutputBlockProposal.target')}</dt>
        <dd>{proposal.preview.target.label || '—'}</dd>
        <dt>{t('notebook.pipelineOutputBlockProposal.impact')}</dt>
        <dd>
          {proposal.impact.mutationClass} · {proposal.impact.affectedRows} row
          {proposal.impact.affectedRows === 1 ? '' : 's'}
          {proposal.impact.createsDraft
            ? t('notebook.pipelineOutputBlockProposal.createsADraft')
            : ''}
        </dd>
      </dl>
      {changes.length ? (
        <ul className="space-y-1.5">
          {changes.map((change, index) => (
            <li key={`${change.path}-${index}`} className="space-y-0.5">
              <p className="font-mono text-[11px]">{change.path}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <ValuePreview value={change.before} />
                <span aria-hidden="true">→</span>
                <ValuePreview value={change.after} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted">
          {t('notebook.pipelineOutputBlockProposal.theProposalDidNot')}
        </p>
      )}
      {runId ? (
        <Link
          to="/pipelines/runs/$runId"
          params={{ runId }}
          className="text-link inline-block underline-offset-2 hover:underline"
        >
          {t('notebook.pipelineOutputBlockProposal.openTheProducingRun')}
        </Link>
      ) : null}
    </div>
  )
}

export function PipelineProposalBlock({
  proposal,
  runId,
  currentOutput,
  readOnly = false,
  pending = null,
  error = null,
  onDecide,
  onExecute,
}: {
  proposal: AgentOperationProposal
  runId?: string | null
  /** What the block shows now, for the Compare view. */
  currentOutput?: string | null
  /** Preview / viewer / signed renderings must not offer decisions. */
  readOnly?: boolean
  pending?: 'approve' | 'reject' | 'execute' | null
  error?: string | null
  onDecide?: (decision: 'approve' | 'reject', reason?: string | null) => void
  onExecute?: () => void
}) {
  const [showCompare, setShowCompare] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const decidable = proposal.status === 'pending'
  const canDecide = !readOnly && decidable && Boolean(onDecide)
  const canExecute =
    !readOnly && proposal.status === 'approved' && Boolean(onExecute)
  const runLabel = runId ? runId.slice(0, 8) : null

  return (
    <div data-proposal-id={proposal.id} className="space-y-2">
      <div
        role="status"
        className="border-border bg-review-wash flex flex-wrap items-center gap-2.5 rounded-md border px-3 py-2"
      >
        <Icon
          name="pipeline"
          size={16}
          className="text-review shrink-0"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 text-sm leading-5">
          <b className="font-semibold">
            {runLabel
              ? t('notebook.pipelineOutputBlockProposal.proposedFromRun', {
                  runLabel,
                })
              : t('notebook.pipelineOutputBlockProposal.proposedFromAnyRun')}
          </b>{' '}
          {proposal.summary}
          {decidable
            ? t('notebook.pipelineOutputBlockProposal.nothingHereChangesUntil')
            : ''}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-expanded={showCompare}
            onClick={() => setShowCompare((value) => !value)}
          >
            {t('notebook.pipelineOutputBlockProposal.compare')}
          </Button>
          {canDecide ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="quiet"
                disabled={pending !== null}
                onClick={() => setRejecting(true)}
              >
                {t('notebook.pipelineOutputBlockProposal.reject')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={pending !== null}
                onClick={() => onDecide?.('approve')}
              >
                {pending === 'approve'
                  ? t('notebook.pipelineOutputBlockProposal.accepting')
                  : t('notebook.pipelineOutputBlockProposal.accept')}
              </Button>
            </>
          ) : null}
          {canExecute ? (
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={pending !== null}
              onClick={() => onExecute?.()}
            >
              {pending === 'execute'
                ? t('notebook.pipelineOutputBlockProposal.applying')
                : t('notebook.pipelineOutputBlockProposal.applyChange')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Status tone={STATUS_TONE[proposal.status]}>
          {STATUS_LABEL[proposal.status]}
        </Status>
        <span className="text-fg-muted">
          {agentOperationLabel(proposal.operation_kind)}
        </span>
        {proposal.status === 'rejected' && proposal.rejection_reason ? (
          <span className="text-fg-muted">
            {t('notebook.pipelineOutputBlockProposal.reasonRejectionReason', {
              rejection_reason: proposal.rejection_reason,
            })}
          </span>
        ) : null}
        {proposal.status === 'failed' && proposal.error_message ? (
          <span className="text-danger-text">{proposal.error_message}</span>
        ) : null}
      </div>

      {readOnly && decidable ? (
        <p className="text-fg-muted text-xs">
          <Link
            to="/pipelines/agents"
            search={{ view: 'proposals', proposal: proposal.id }}
            className="text-link underline-offset-2 hover:underline"
          >
            {t('notebook.pipelineOutputBlockProposal.decideThisProposalIn')}
          </Link>
        </p>
      ) : null}

      {error ? (
        <Notice
          tone="bad"
          title={t('notebook.pipelineOutputBlockProposal.title')}
        >
          {error}
        </Notice>
      ) : null}

      {rejecting && canDecide ? (
        <div className="border-border space-y-2 rounded-md border p-3">
          <Field label={t('notebook.pipelineOutputBlockProposal.label')}>
            <Textarea
              aria-label={t('notebook.pipelineOutputBlockProposal.label')}
              rows={2}
              value={reason}
              placeholder={t(
                'notebook.pipelineOutputBlockProposal.placeholder',
              )}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={!reason.trim() || pending !== null}
              onClick={() => onDecide?.('reject', reason.trim())}
            >
              {t('notebook.pipelineOutputBlockProposal.rejectProposal')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => {
                setRejecting(false)
                setReason('')
              }}
            >
              {t('common.actions.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {showCompare ? (
        <ComparePanel
          proposal={proposal}
          runId={runId}
          currentOutput={currentOutput}
        />
      ) : null}
    </div>
  )
}

/** Stated absence — no proposal is pinned to the block. */
export function PipelineProposalAbsent({ className }: { className?: string }) {
  return (
    <p
      role="status"
      data-proposal-state="absent"
      className={
        className ??
        'text-fg-muted rounded-md border border-dashed p-3 text-xs leading-5'
      }
    >
      {PROPOSAL_ABSENT_MESSAGE}
    </p>
  )
}

/** The linked proposal exists but this caller cannot read the row. */
export function PipelineProposalUnreadable({
  className,
}: {
  className?: string
}) {
  return (
    <p
      role="status"
      data-proposal-state="unreadable"
      className={
        className ??
        'text-fg-muted rounded-md border border-dashed p-3 text-xs leading-5'
      }
    >
      {PROPOSAL_UNREADABLE_MESSAGE}
    </p>
  )
}
