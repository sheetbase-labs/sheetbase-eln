import {
  Bot,
  CirclePause,
  CircleStop,
  RotateCcw,
  StepForward,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  Progress,
  ScrollArea,
  Separator,
  Textarea,
} from '#/components/ui'
import type {
  AgentWorkflow,
  AgentWorkflowEvent,
  AgentWorkflowStep,
  AgentWorkflowStepGate,
} from '#/lib/agent-workflows'
import {
  dryRunAgentWorkflow,
  summarizeWorkflowApprovals,
  summarizeWorkflowRecovery,
  summarizeWorkflowRunMetrics,
  workflowCostUsd,
} from '#/lib/agent-workflows'
import {
  AGENT_EVIDENCE_HUMAN_ATTESTATION_NOTE,
  extractAgentOutputReferences,
  markWorkflowStepEvidence,
} from '#/lib/agent-provenance'
import type { AgentOperationProposal } from '#/lib/agent-operations'
import { cn } from '#/lib/utils'

interface WorkflowWorkbenchProps {
  workflows: AgentWorkflow[]
  steps: AgentWorkflowStep[]
  events: AgentWorkflowEvent[]
  /** Loaded operation proposals for joining per-step preview, impact, and gates. */
  proposals?: AgentOperationProposal[]
  selectedId: string | null
  onSelect: (workflowId: string) => void
  onAdvance: (workflow: AgentWorkflow) => void
  onResume: (workflow: AgentWorkflow) => void
  onCancel: (workflow: AgentWorkflow, reason: string) => void
  onInspectProposal: (proposalId: string) => void
  pendingAction?: 'advance' | 'resume' | 'cancel' | null
}

export function WorkflowWorkbench({
  workflows,
  steps,
  events,
  proposals = [],
  selectedId,
  onSelect,
  onAdvance,
  onResume,
  onCancel,
  onInspectProposal,
  pendingAction = null,
}: WorkflowWorkbenchProps) {
  const selected =
    workflows.find((workflow) => workflow.id === selectedId) ??
    workflows.at(0) ??
    null
  const [cancellationReason, setCancellationReason] = useState('')

  useEffect(() => setCancellationReason(''), [selected?.id])
  const proposalsById = useMemo<Record<string, AgentOperationProposal>>(() => {
    const byId: Record<string, AgentOperationProposal> = {}
    for (const proposal of proposals) byId[proposal.id] = proposal
    return byId
  }, [proposals])
  const dryRun = useMemo(
    () => dryRunAgentWorkflow(steps, proposalsById),
    [steps, proposalsById],
  )
  const approvals = useMemo(() => summarizeWorkflowApprovals(dryRun), [dryRun])
  const recovery = useMemo(
    () => (selected ? summarizeWorkflowRecovery(selected, steps) : null),
    [selected, steps],
  )
  const runMetrics = useMemo(
    () => (selected ? summarizeWorkflowRunMetrics(selected, steps) : null),
    [selected, steps],
  )

  const gateByStepKey = useMemo<
    Record<string, (typeof dryRun)[number]['gate']>
  >(() => {
    const byKey: Record<string, (typeof dryRun)[number]['gate']> = {}
    for (const preview of dryRun) byKey[preview.stepKey] = preview.gate
    return byKey
  }, [dryRun])
  if (!selected) {
    return (
      <Empty className="border-border m-4 border">
        <EmptyIcon>
          <Bot className="size-8" />
        </EmptyIcon>
        <EmptyTitle>No agent workflows</EmptyTitle>
        <EmptyDescription>
          Agent credentials submit pinned multi-step plans through the Sheetbase
          API. Safe drafts and delegated create/append writes can run
          automatically. Other Dataset writes wait here for human approval.
        </EmptyDescription>
      </Empty>
    )
  }

  const isTerminal = ['succeeded', 'cancelled', 'budget_exhausted'].includes(
    selected.status,
  )
  const operationPercent =
    (selected.used_operations / selected.max_operations) * 100
  const tokenPercent =
    Number(selected.max_tokens) === 0
      ? Number(selected.used_tokens) > 0
        ? 100
        : 0
      : (Number(selected.used_tokens) / Number(selected.max_tokens)) * 100
  const costPercent =
    Number(selected.max_cost_microusd) === 0
      ? Number(selected.used_cost_microusd) > 0
        ? 100
        : 0
      : (Number(selected.used_cost_microusd) /
          Number(selected.max_cost_microusd)) *
        100

  return (
    <div className="border-border grid min-h-0 flex-1 border-t lg:grid-cols-[320px_minmax(0,1fr)]">
      <ScrollArea className="bg-sidebar border-border min-h-[260px] border-b lg:border-r lg:border-b-0">
        <div className="p-2">
          {workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => onSelect(workflow.id)}
              className={cn(
                'focus-visible:ring-ring mb-1 w-full rounded-md px-3 py-2.5 text-left outline-none focus-visible:ring-2',
                workflow.id === selected.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium">
                  {workflow.goal}
                </span>
                <WorkflowStatus status={workflow.status} />
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Step{' '}
                {Math.min(
                  workflow.current_step + 1,
                  workflow.plan.steps.length,
                )}{' '}
                of {workflow.plan.steps.length}
              </p>
              <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                {workflow.created_at.slice(0, 16).replace('T', ' ')} · r
                {workflow.revision}
              </p>
            </button>
          ))}
        </div>
      </ScrollArea>

      <ScrollArea className="min-h-0">
        <article className="mx-auto max-w-5xl p-4 lg:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <WorkflowStatus status={selected.status} />
                <Badge variant="secondary">Agent-produced</Badge>
                <Badge variant="outline">sequential · policy gated</Badge>
                <Badge variant="secondary">
                  {selected.plan.steps.length} pinned steps
                </Badge>
                {approvals.pendingApproval.length > 0 && (
                  <Badge variant="danger">
                    {approvals.pendingApproval.length} pending approval
                  </Badge>
                )}
                {approvals.approved.length > 0 && (
                  <Badge variant="default">
                    {approvals.approved.length} approved
                  </Badge>
                )}
                {approvals.rejected.length > 0 && (
                  <Badge variant="outline">
                    {approvals.rejected.length} rejected
                  </Badge>
                )}
              </div>
              <h2 className="text-lg font-semibold">{selected.goal}</h2>
              <p className="text-muted-foreground mt-1 font-mono text-xs">
                Plan {selected.plan_digest}
              </p>
            </div>
            <div className="flex max-w-80 flex-col items-end gap-2">
              {selected.status === 'waiting_approval' && (
                <Button
                  variant="outline"
                  onClick={() => onAdvance(selected)}
                  disabled={pendingAction !== null}
                >
                  <StepForward className="size-4" /> Check step outcome
                </Button>
              )}
              {selected.status === 'paused' && (
                <Button
                  onClick={() => onResume(selected)}
                  disabled={pendingAction !== null}
                >
                  <RotateCcw className="size-4" /> Resume exact step
                </Button>
              )}
              {!isTerminal && (
                <div className="flex w-full gap-2">
                  <Textarea
                    aria-label="Workflow cancellation reason"
                    value={cancellationReason}
                    onChange={(event) =>
                      setCancellationReason(event.target.value)
                    }
                    placeholder="Reason required to cancel"
                    className="min-h-16 text-xs"
                  />
                  <Button
                    variant="outline"
                    aria-label="Cancel workflow"
                    onClick={() => onCancel(selected, cancellationReason)}
                    disabled={
                      !cancellationReason.trim() || pendingAction !== null
                    }
                  >
                    <CircleStop className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {selected.status === 'paused' && (
            <div
              role="status"
              className="border-warning/30 bg-warning/5 mt-4 flex gap-2 rounded-md border p-3 text-sm"
            >
              <CirclePause className="mt-0.5 size-4 shrink-0" />
              <span>
                The current proposal failed or was rejected. Resume creates a
                new proposal for the same pinned operation under a fresh
                idempotency key — completed steps keep their results and are
                never re-executed.
                {recovery && (
                  <>
                    {' '}
                    Next resume is attempt{' '}
                    {(steps.find(
                      (step) => step.position === selected.current_step,
                    )?.attempt ?? 0) + 1}{' '}
                    with {recovery.retriesRemaining} operation
                    {recovery.retriesRemaining === 1 ? '' : 's'} of retry budget
                    left.
                  </>
                )}{' '}
                Change the plan by cancelling and submitting a new workflow.
              </span>
            </div>
          )}
          {selected.status === 'cancelled' && (
            <div
              role="status"
              className="border-border bg-muted/40 mt-4 flex gap-2 rounded-md border p-3 text-sm"
            >
              <CircleStop className="mt-0.5 size-4 shrink-0" />
              <span>
                Cancelled
                {selected.cancellation_reason
                  ? `: ${selected.cancellation_reason}`
                  : ''}
                . Partial state is preserved: {recovery?.completed.length ?? 0}{' '}
                completed step
                {(recovery?.completed.length ?? 0) === 1 ? '' : 's'} keep
                {(recovery?.completed.length ?? 0) === 1 ? 's' : ''}{' '}
                {(recovery?.completed.length ?? 0) === 1 ? 'its' : 'their'}{' '}
                results below; unfinished steps are terminal. Continue with a
                new workflow.
              </span>
            </div>
          )}

          <Separator className="my-5" />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
              <section aria-labelledby="workflow-dry-run">
                <h3 id="workflow-dry-run" className="text-sm font-semibold">
                  Dry-run preview
                </h3>
                <p className="text-muted-foreground mt-1 text-xs">
                  Read-only preview of every step — no state advances. Proposed
                  steps show the stored PostgreSQL preview, impact, and risk;
                  planned steps show the catalogue prediction. Consequential
                  (mutate) steps need explicit human approval through the decide
                  path.
                </p>
                <ol className="border-border mt-2 overflow-hidden rounded-md border">
                  {dryRun.map((preview) => (
                    <li
                      key={preview.stepKey}
                      className="border-border border-b p-3 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {preview.position + 1}. {preview.title}
                          </p>
                          <p className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                            {preview.tool} · {preview.mode} ·{' '}
                            {preview.operationKind} · {preview.riskClass}
                          </p>
                        </div>
                        <StepGateBadge gate={preview.gate} />
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {preview.gate === 'planned' && (
                          <>
                            Not yet proposed.
                            {preview.requiresExplicitApproval
                              ? ' Will wait for human approval once proposed.'
                              : ' Eligible to flow automatically once proposed.'}
                          </>
                        )}
                        {preview.gate === 'pending-approval' && (
                          <>
                            Awaiting explicit human approval — approve the
                            proposal, then execute.
                          </>
                        )}
                        {preview.gate === 'approved' && (
                          <>Approved by a human — awaiting execution.</>
                        )}
                        {preview.gate === 'rejected' && (
                          <>
                            Rejected by a human — resume retries the same pinned
                            operation; it never revives this decision.
                          </>
                        )}
                        {preview.gate === 'flowing' && (
                          <>
                            Moving under automatic or delegated policy — no
                            human click needed.
                          </>
                        )}
                        {preview.gate === 'succeeded' && (
                          <>
                            Completed — the canonical result is kept and never
                            re-executed.
                          </>
                        )}
                        {preview.gate === 'failed' && (
                          <>
                            Failed validation or execution — retryable by human
                            resume within budget.
                          </>
                        )}
                        {preview.gate === 'cancelled' && (
                          <>
                            Cancelled — terminal and inspectable; continue with
                            a new workflow.
                          </>
                        )}
                      </p>
                      {preview.preview && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Preview: {preview.preview.changes.length} change
                          {preview.preview.changes.length === 1 ? '' : 's'}
                          {preview.impact && (
                            <>
                              {' '}
                              · impact {preview.impact.mutationClass}
                              {preview.impact.affectedRows > 0 && (
                                <> · {preview.impact.affectedRows} rows</>
                              )}
                            </>
                          )}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
              <section aria-labelledby="workflow-plan">
                <h3 id="workflow-plan" className="text-sm font-semibold">
                  Pinned plan
                </h3>
                <ol className="border-border mt-2 overflow-hidden rounded-md border">
                  {steps.map((step) => (
                    <li
                      key={step.id}
                      className="border-border border-b p-3 last:border-b-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {step.position + 1}. {step.title}
                          </p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {step.summary}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StepGateBadge
                            gate={gateByStepKey[step.step_key] ?? 'planned'}
                          />
                          <Badge variant="outline">{step.status}</Badge>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <code>{step.tool_name}</code>
                        <span className="text-muted-foreground">
                          attempt {step.attempt}
                        </span>
                        {step.proposal_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              onInspectProposal(step.proposal_id ?? '')
                            }
                          >
                            Inspect proposal
                          </Button>
                        )}
                      </div>
                      {(() => {
                        const linked = step.proposal_id
                          ? (proposalsById[step.proposal_id] ?? null)
                          : null
                        const pins = step.input_references.map((reference) => ({
                          key: `in:${reference.kind}:${reference.id}`,
                          text: `pin ${reference.kind}: ${reference.id}`,
                        }))
                        const outputs = extractAgentOutputReferences(
                          step.operation,
                          linked?.status === 'succeeded' ? linked.result : null,
                        ).map((reference) => ({
                          key: `out:${reference.kind}:${reference.id}`,
                          text: `out ${reference.kind}: ${reference.id}`,
                        }))
                        const rows = [...pins, ...outputs]
                        if (rows.length === 0) return null
                        return (
                          <ul className="text-muted-foreground mt-2 space-y-1 font-mono text-[11px]">
                            {rows.map((row) => (
                              <li key={row.key}>{row.text}</li>
                            ))}
                          </ul>
                        )
                      })()}
                      {(() => {
                        const marking = markWorkflowStepEvidence(
                          step,
                          step.proposal_id
                            ? (proposalsById[step.proposal_id] ?? null)
                            : null,
                        )
                        return (
                          <p className="text-muted-foreground mt-2 text-[11px]">
                            Agent-produced ·{' '}
                            {marking.qualifiesForSubmission
                              ? 'may enter submitted work after human review'
                              : marking.qualification}
                          </p>
                        )
                      })()}
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <aside className="space-y-5">
              <section aria-labelledby="workflow-budget">
                <h3 id="workflow-budget" className="text-sm font-semibold">
                  Budget and usage
                </h3>
                <div className="mt-3 space-y-3">
                  <UsageBar
                    label="Operations"
                    used={String(selected.used_operations)}
                    limit={String(selected.max_operations)}
                    percent={operationPercent}
                  />
                  <UsageBar
                    label="Tokens"
                    used={String(selected.used_tokens)}
                    limit={String(selected.max_tokens)}
                    percent={tokenPercent}
                  />
                  <UsageBar
                    label="Cost"
                    used={`$${workflowCostUsd(selected)}`}
                    limit={`$${(Number(selected.max_cost_microusd) / 1_000_000).toFixed(4)}`}
                    percent={costPercent}
                  />
                </div>
                {runMetrics && (
                  <dl className="mt-3 space-y-2 text-sm">
                    <Property
                      label="Wall latency"
                      value={
                        runMetrics.wallLatencyMs == null
                          ? 'Running — measured at completion'
                          : `${(runMetrics.wallLatencyMs / 1000).toFixed(1)}s`
                      }
                    />
                    <Property
                      label="Steps"
                      value={`${runMetrics.steps.succeeded}/${runMetrics.steps.total} succeeded${runMetrics.steps.failed > 0 ? ` · ${runMetrics.steps.failed} failed` : ''}${runMetrics.steps.rejected > 0 ? ` · ${runMetrics.steps.rejected} rejected` : ''}${runMetrics.steps.cancelled > 0 ? ` · ${runMetrics.steps.cancelled} cancelled` : ''}`}
                    />
                  </dl>
                )}
              </section>

              <section aria-labelledby="workflow-provenance">
                <h3 id="workflow-provenance" className="text-sm font-semibold">
                  Agent provenance
                </h3>
                <dl className="mt-2 space-y-2 text-sm">
                  <Property label="Agent" value={selected.provenance.agentId} />
                  <Property
                    label="Tool"
                    value={selected.provenance.tool.name}
                  />
                  <Property
                    label="Model"
                    value={`${selected.provenance.model.provider} / ${selected.provenance.model.name}`}
                  />
                  <Property
                    label="Invocation"
                    value={selected.provenance.invocationId}
                    mono
                  />
                </dl>
                <p className="text-muted-foreground mt-2 text-xs">
                  {AGENT_EVIDENCE_HUMAN_ATTESTATION_NOTE}
                </p>
              </section>

              <section aria-labelledby="workflow-timeline">
                <h3 id="workflow-timeline" className="text-sm font-semibold">
                  Workflow timeline
                </h3>
                <ol className="border-border mt-2 border-l pl-4">
                  {events.map((event) => (
                    <li key={event.id} className="relative pb-4 last:pb-0">
                      <span className="bg-primary absolute top-1.5 -left-[19px] size-2 rounded-full" />
                      <p className="text-sm font-medium">
                        {event.event_type.replaceAll('_', ' ')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {event.created_at.slice(0, 16).replace('T', ' ')}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
        </article>
      </ScrollArea>
    </div>
  )
}

function WorkflowStatus({ status }: { status: AgentWorkflow['status'] }) {
  const variant =
    status === 'cancelled' || status === 'budget_exhausted'
      ? 'danger'
      : status === 'succeeded'
        ? 'default'
        : 'secondary'
  return <Badge variant={variant}>{status.replaceAll('_', ' ')}</Badge>
}
function StepGateBadge({ gate }: { gate: AgentWorkflowStepGate }) {
  const variant =
    gate === 'pending-approval'
      ? 'danger'
      : gate === 'approved'
        ? 'default'
        : gate === 'rejected' || gate === 'failed' || gate === 'cancelled'
          ? 'outline'
          : 'secondary'
  return <Badge variant={variant}>{gate.replaceAll('-', ' ')}</Badge>
}

function UsageBar({
  label,
  used,
  limit,
  percent,
}: {
  label: string
  used: string
  limit: string
  percent: number
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {used} / {limit}
        </span>
      </div>
      <Progress value={Math.min(percent, 100)} />
    </div>
  )
}

function Property({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn('mt-0.5 break-all', mono && 'font-mono text-xs')}>
        {value}
      </dd>
    </div>
  )
}
