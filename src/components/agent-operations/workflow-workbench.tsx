import {
  Bot,
  CirclePause,
  CircleStop,
  RotateCcw,
  StepForward,
} from 'lucide-react'
import { useEffect, useState } from 'react'

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
} from '#/lib/agent-workflows'
import { workflowCostUsd } from '#/lib/agent-workflows'
import { cn } from '#/lib/utils'

interface WorkflowWorkbenchProps {
  workflows: AgentWorkflow[]
  steps: AgentWorkflowStep[]
  events: AgentWorkflowEvent[]
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
                <Badge variant="outline">sequential · policy gated</Badge>
                <Badge variant="secondary">
                  {selected.plan.steps.length} pinned steps
                </Badge>
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
              The current proposal failed or was rejected. Resume creates a new
              proposal for the same pinned operation. Change the plan by
              cancelling and submitting a new workflow.
            </div>
          )}

          <Separator className="my-5" />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
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
                        <Badge variant="outline">{step.status}</Badge>
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
                      {step.input_references.length > 0 && (
                        <ul className="text-muted-foreground mt-2 space-y-1 font-mono text-[11px]">
                          {step.input_references.map((reference) => (
                            <li key={`${reference.kind}:${reference.id}`}>
                              {reference.kind}: {reference.id}
                            </li>
                          ))}
                        </ul>
                      )}
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
