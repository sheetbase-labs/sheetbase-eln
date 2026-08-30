import { AlertTriangle, Bot, Check, Play, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { agentOperationLabel, proposalRevision } from '#/lib/agent-operations'
import type {
  AgentOperationEvent,
  AgentOperationProposal,
} from '#/lib/agent-operations'
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyIcon,
  EmptyTitle,
  ScrollArea,
  Separator,
  Textarea,
} from '#/components/ui'
import { cn } from '#/lib/utils'

interface ProposalWorkbenchProps {
  proposals: AgentOperationProposal[]
  events: AgentOperationEvent[]
  selectedId: string | null
  onSelect: (proposalId: string) => void
  onApprove: (proposal: AgentOperationProposal) => void
  onReject: (proposal: AgentOperationProposal, reason: string) => void
  onExecute: (proposal: AgentOperationProposal) => void
  canApprove: boolean
  pendingAction?: 'approve' | 'reject' | 'execute' | null
}

export function ProposalWorkbench({
  proposals,
  events,
  selectedId,
  onSelect,
  onApprove,
  onReject,
  onExecute,
  canApprove,
  pendingAction = null,
}: ProposalWorkbenchProps) {
  const selected =
    proposals.find((proposal) => proposal.id === selectedId) ??
    proposals.at(0) ??
    null
  const [rejectionReason, setRejectionReason] = useState('')

  useEffect(() => setRejectionReason(''), [selected?.id])

  if (!selected) {
    return (
      <Empty className="border-border m-4 border">
        <EmptyIcon>
          <Bot className="size-8" />
        </EmptyIcon>
        <EmptyTitle>No operation proposals</EmptyTitle>
        <EmptyDescription>
          Agent tools submit typed proposals through the Sheetbase API. Each
          proposal appears here with its exact impact before any mutation.
        </EmptyDescription>
      </Empty>
    )
  }

  return (
    <div className="border-border grid min-h-0 flex-1 border-t lg:grid-cols-[320px_minmax(0,1fr)]">
      <ScrollArea className="bg-sidebar border-border min-h-[260px] border-b lg:border-r lg:border-b-0">
        <div className="p-2">
          {proposals.map((proposal) => (
            <button
              key={proposal.id}
              type="button"
              onClick={() => onSelect(proposal.id)}
              className={cn(
                'focus-visible:ring-ring mb-1 w-full rounded-md px-3 py-2.5 text-left outline-none focus-visible:ring-2',
                proposal.id === selected.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-sm font-medium">
                  {proposal.title}
                </span>
                <ProposalStatus status={proposal.status} />
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {agentOperationLabel(proposal.operation_kind)}
              </p>
              <p className="text-muted-foreground mt-1 font-mono text-[11px]">
                {proposal.created_at.slice(0, 16).replace('T', ' ')} · r
                {proposalRevision(proposal)}
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
                <ProposalStatus status={selected.status} />
                <Badge variant="outline">
                  {selected.approval_policy.replaceAll('_', ' ')}
                </Badge>
                <Badge variant="outline">
                  {selected.risk_class.replaceAll('_', ' ')}
                </Badge>
                <Badge variant="secondary">
                  {selected.impact.mutationClass}
                </Badge>
              </div>
              <h2 className="text-lg font-semibold">{selected.title}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {selected.summary}
              </p>
            </div>
            <ProposalActions
              proposal={selected}
              canApprove={canApprove}
              pendingAction={pendingAction}
              rejectionReason={rejectionReason}
              setRejectionReason={setRejectionReason}
              onApprove={onApprove}
              onReject={onReject}
              onExecute={onExecute}
            />
          </div>

          {selected.status === 'failed' && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive mt-4 flex gap-2 rounded-md border p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {selected.error_code}: {selected.error_message}
              </span>
            </div>
          )}

          <Separator className="my-5" />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              <section aria-labelledby="proposal-impact">
                <h3 id="proposal-impact" className="text-sm font-semibold">
                  Policy decision and impact
                </h3>
                <dl className="border-border mt-2 grid grid-cols-2 overflow-hidden rounded-md border text-sm sm:grid-cols-4">
                  <Metric label="Target" value={selected.impact.target.label} />
                  <Metric
                    label="Rows"
                    value={String(selected.impact.affectedRows)}
                  />
                  <Metric
                    label="Creates draft"
                    value={selected.impact.createsDraft ? 'Yes' : 'No'}
                  />
                  <Metric label="Destructive" value="No" />
                </dl>
                <div className="bg-muted mt-2 rounded-md p-3 text-sm">
                  <p className="font-medium">{selected.policy_reason}</p>
                  <dl className="text-muted-foreground mt-2 grid gap-1 text-xs sm:grid-cols-2">
                    <Property
                      label="Matched policy"
                      value={selected.policy_id ?? 'Default risk policy'}
                      mono={Boolean(selected.policy_id)}
                    />
                    <Property
                      label="Policy limits"
                      value={JSON.stringify(selected.policy_limits)}
                      mono
                    />
                    <Property
                      label="Evaluation evidence"
                      value={JSON.stringify(selected.policy_evidence)}
                      mono
                    />
                    <Property
                      label="Target boundary"
                      value={JSON.stringify(selected.policy_target)}
                      mono
                    />
                  </dl>
                </div>
              </section>

              <section aria-labelledby="proposal-diff">
                <h3 id="proposal-diff" className="text-sm font-semibold">
                  Proposed diff
                </h3>
                <div className="border-border mt-2 overflow-hidden rounded-md border">
                  {selected.preview.changes.map((change) => (
                    <div
                      key={change.path}
                      className="border-border grid gap-2 border-b p-3 last:border-b-0 md:grid-cols-[160px_1fr]"
                    >
                      <code className="text-xs font-medium">{change.path}</code>
                      <div className="grid min-w-0 gap-2 lg:grid-cols-2">
                        <JsonValue label="Before" value={change.before} />
                        <JsonValue label="After" value={change.after} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="proposal-operation">
                <h3 id="proposal-operation" className="text-sm font-semibold">
                  Canonical operation request
                </h3>
                <pre className="bg-muted border-border mt-2 max-h-80 overflow-auto rounded-md border p-3 text-xs">
                  {JSON.stringify(selected.operation, null, 2)}
                </pre>
              </section>
            </div>

            <aside className="space-y-5">
              <section aria-labelledby="proposal-provenance">
                <h3 id="proposal-provenance" className="text-sm font-semibold">
                  Agent provenance
                </h3>
                <dl className="mt-2 space-y-2 text-sm">
                  <Property label="Agent" value={selected.provenance.agentId} />
                  <Property
                    label="Tool"
                    value={[
                      selected.provenance.tool.name,
                      selected.provenance.tool.version,
                    ]
                      .filter(Boolean)
                      .join(' ')}
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
                  <Property
                    label="Request digest"
                    value={selected.request_digest}
                    mono
                  />
                </dl>
              </section>

              <section aria-labelledby="proposal-timeline">
                <h3 id="proposal-timeline" className="text-sm font-semibold">
                  Evidence timeline
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

function ProposalActions({
  proposal,
  canApprove,
  pendingAction,
  rejectionReason,
  setRejectionReason,
  onApprove,
  onReject,
  onExecute,
}: {
  proposal: AgentOperationProposal
  canApprove: boolean
  pendingAction: ProposalWorkbenchProps['pendingAction']
  rejectionReason: string
  setRejectionReason: (reason: string) => void
  onApprove: ProposalWorkbenchProps['onApprove']
  onReject: ProposalWorkbenchProps['onReject']
  onExecute: ProposalWorkbenchProps['onExecute']
}) {
  if (!canApprove) {
    return (
      <p className="text-muted-foreground max-w-64 text-xs">
        Your role can inspect this proposal but cannot approve its canonical
        operation.
      </p>
    )
  }
  if (proposal.status === 'approved') {
    return (
      <Button
        onClick={() => onExecute(proposal)}
        disabled={pendingAction !== null}
      >
        <Play className="size-4" /> Execute approved operation
      </Button>
    )
  }
  if (proposal.status !== 'pending') return null
  return (
    <div className="w-full space-y-2 sm:w-72">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => onReject(proposal, rejectionReason)}
          disabled={!rejectionReason.trim() || pendingAction !== null}
        >
          <X className="size-4" /> Reject
        </Button>
        <Button
          onClick={() => onApprove(proposal)}
          disabled={pendingAction !== null}
        >
          <Check className="size-4" /> Approve
        </Button>
      </div>
      <Textarea
        aria-label="Rejection reason"
        value={rejectionReason}
        onChange={(event) => setRejectionReason(event.target.value)}
        placeholder="Reason required to reject"
        className="min-h-16 text-xs"
      />
    </div>
  )
}

function ProposalStatus({
  status,
}: {
  status: AgentOperationProposal['status']
}) {
  const variant =
    status === 'failed' || status === 'rejected'
      ? 'danger'
      : status === 'succeeded' || status === 'approved'
        ? 'default'
        : 'secondary'
  return <Badge variant={variant}>{status}</Badge>
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border border-r p-3 last:border-r-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 truncate font-medium">{value}</dd>
    </div>
  )
}

function JsonValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="bg-muted min-w-0 rounded p-2">
      <p className="text-muted-foreground mb-1 text-[11px] font-medium">
        {label}
      </p>
      <pre className="max-h-40 overflow-auto text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
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
