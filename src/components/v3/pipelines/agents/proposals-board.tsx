import { useEffect, useState } from 'react'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { CodeBlock } from '#/components/v3/ui/code-block'
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Icon } from '#/components/v3/icons'
import { Notice } from '#/components/v3/ui/alert'
import { DescriptionList, Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Textarea } from '#/components/v3/inventory/list'
import type {
  AgentOperationEvent,
  AgentOperationProposal,
} from '#/lib/agent-operations'
import { agentOperationLabel } from '#/lib/agent-operations'
import {
  actionLabel,
  proposalEvidence,
  proposalRendered,
  proposalRisk,
  proposalStage,
  proposalStatusLabel,
  proposalSubject,
  shortStamp,
} from '#/lib/agent-registry'
import type {
  AgentDefinition,
  AgentRun,
  ProposalStage,
  RenderedChange,
} from '#/lib/agent-registry'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'
import { RiskGlyph, linkifyIdentifiers } from './board-parts'

/**
 * The Agents Proposals board: what needs you, what waits on someone else, and
 * what was decided, with the proposed change, its evidence and why it needs
 * approval beside the list. The raw operation stays under Technical details.
 */

const STAGE_LABEL: Record<ProposalStage, string> = {
  needs: 'Needs your approval',
  waiting: 'Waiting on others',
  decided: 'Decided · last 7 days',
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function statusTone(
  proposal: AgentOperationProposal,
  stage: ProposalStage,
): Tone {
  switch (proposal.status) {
    case 'pending':
      return stage === 'decided' ? 'draft' : 'review'
    case 'approved':
    case 'executing':
      return 'progress'
    case 'succeeded':
      return 'ok'
    case 'failed':
      return 'bad'
    default:
      return 'stored'
  }
}

/** Number in a proposal's PR-0412 name, so the newest sorts first. */
function ordinal(proposal: AgentOperationProposal): number {
  return Number(/\d+/.exec(proposal.display_id ?? '')?.[0] ?? 0)
}

export function proposalBoardGroups(
  proposals: readonly AgentOperationProposal[],
  me: { userId: string | null; canApprove: boolean },
  now: Date,
): Array<{
  stage: ProposalStage
  key: string
  label: string
  items: AgentOperationProposal[]
}> {
  const groups: Record<ProposalStage, AgentOperationProposal[]> = {
    needs: [],
    waiting: [],
    decided: [],
  }
  for (const proposal of proposals) {
    const stage = proposalStage(proposal, me)
    if (
      stage === 'decided' &&
      now.getTime() - Date.parse(proposal.updated_at) > WEEK_MS
    )
      continue
    groups[stage].push(proposal)
  }
  const byNewest = (list: AgentOperationProposal[]) =>
    list.sort((a, b) => ordinal(b) - ordinal(a))
  // What needs you is two kinds of ask, so each gets its own heading rather
  // than rows saying "signature" under a heading that says "approval".
  const needsSignature = groups.needs.filter((p) => p.signature_required)
  const needsApproval = groups.needs.filter((p) => !p.signature_required)
  return [
    {
      stage: 'needs' as const,
      key: 'needs-approval',
      label: STAGE_LABEL.needs,
      items: byNewest(needsApproval),
    },
    {
      stage: 'needs' as const,
      key: 'needs-signature',
      label: 'Needs your signature',
      items: byNewest(needsSignature),
    },
    {
      stage: 'waiting' as const,
      key: 'waiting',
      label: STAGE_LABEL.waiting,
      items: byNewest(groups.waiting),
    },
    {
      stage: 'decided' as const,
      key: 'decided',
      label: STAGE_LABEL.decided,
      items: byNewest(groups.decided),
    },
  ].filter((group) => group.items.length > 0)
}

function RenderedBlock({ rendered }: { rendered: RenderedChange }) {
  return (
    <div className="flex flex-col gap-2">
      {rendered.sections.map((section, index) =>
        section.kind === 'unchanged' ? (
          <div
            key={index}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-label"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium">{section.title}</span>
              {section.subtitle ? (
                <span className="text-fg-muted"> · {section.subtitle}</span>
              ) : null}
            </span>
            <span className="text-fg-muted">unchanged</span>
          </div>
        ) : (
          <div
            key={index}
            className="rounded-md border border-border-strong bg-surface p-2.5"
          >
            <div className="flex items-center gap-2 text-label">
              <Badge
                variant={
                  section.kind === 'added'
                    ? 'add'
                    : section.kind === 'removed'
                      ? 'del'
                      : 'chg'
                }
              >
                {section.kind === 'added'
                  ? 'Added'
                  : section.kind === 'removed'
                    ? 'Removed'
                    : 'Changed'}
              </Badge>
              <span className="min-w-0 truncate font-medium">
                {section.title}
              </span>
              {section.subtitle ? (
                <span className="text-fg-muted">{section.subtitle}</span>
              ) : null}
            </div>
            {section.table ? (
              <table className="num mt-2 w-full border-collapse text-label">
                <thead>
                  <tr className="text-fg-muted">
                    {section.table.columns.map((column, i) => (
                      <th
                        key={column}
                        className={cn(
                          'py-1 font-normal',
                          i === 0 ? 'text-left' : 'text-right',
                        )}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row, r) => (
                    <tr key={r} className="border-t border-border">
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className={cn(
                            'py-1',
                            c === 0 ? 'text-left' : 'text-right',
                          )}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {section.caption ? (
              <p className="m-0 mt-2 text-label text-fg-muted">
                {section.caption}
              </p>
            ) : null}
          </div>
        ),
      )}
      {rendered.footer ? (
        <p className="m-0 text-label text-fg-muted">
          {linkifyIdentifiers(rendered.footer)}
        </p>
      ) : null}
    </div>
  )
}

function policyLabel(proposal: AgentOperationProposal): string {
  if (proposal.signature_required) return 'Needs e-signature'
  if (proposal.approval_policy === 'automatic') return 'Allowed'
  if (proposal.approval_policy === 'delegated') return 'Delegated'
  return 'Needs approval'
}

export function AgentProposalsBoard({
  proposals,
  definitions,
  runs,
  events,
  selectedId,
  onSelect,
  onApprove,
  onReject,
  onExecute,
  me,
  canApproveProposal,
  nameOf,
  now,
  pendingAction,
  error,
}: {
  proposals: AgentOperationProposal[]
  definitions: AgentDefinition[]
  runs: AgentRun[]
  events: AgentOperationEvent[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Approve, and run what was approved. `meaning` is the signature, when asked for. */
  onApprove: (proposal: AgentOperationProposal, meaning: string | null) => void
  onReject: (proposal: AgentOperationProposal, reason: string) => void
  onExecute: (proposal: AgentOperationProposal) => void
  me: { userId: string | null; canApprove: boolean }
  /** Whether this person's role may decide this kind of proposal. */
  canApproveProposal: (proposal: AgentOperationProposal) => boolean
  nameOf: (userId: string | null) => string | null
  now: Date
  pendingAction: 'approve' | 'reject' | 'execute' | null
  error?: string | null
}) {
  const groups = proposalBoardGroups(proposals, me, now)
  const visible = groups.flatMap((g) => g.items)
  const selected =
    visible.find((p) => p.id === selectedId) ?? visible.at(0) ?? null
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [signing, setSigning] = useState(false)
  const [meaning, setMeaning] = useState('I approve this proposal')
  useEffect(() => {
    setRejecting(false)
    setReason('')
    setSigning(false)
  }, [selected?.id])

  if (!selected) {
    return (
      <EmptyState
        icon="pipeline"
        title="No proposals"
        description="When a workflow proposes a change, it appears here with the change, its evidence and what approving it does."
      />
    )
  }

  const stage = proposalStage(selected, me)
  const definition = definitions.find(
    (d) => d.id === selected.agent_definition_id,
  )
  const run = runs.find((r) => r.id === selected.agent_run_id)
  const subject = proposalSubject(selected)
  const evidence = proposalEvidence(selected)
  const rendered = proposalRendered(selected)
  const mayDecide =
    stage === 'needs' &&
    selected.status === 'pending' &&
    canApproveProposal(selected)
  const approverName = nameOf(selected.approver_user_id)
  const revision = /rev \d+/.exec(subject.label ?? '')?.[0]
  const busy = pendingAction !== null

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="m-0 border-y border-border bg-surface-muted px-4 py-1.5 text-label font-medium text-fg-muted md:px-6">
              {group.label}
              <span className="num ml-1.5 font-normal">
                {group.items.length}
              </span>
            </h2>
            <ul className="m-0 list-none p-0">
              {group.items.map((p) => {
                const rowStage = group.stage
                const rowSubject = proposalSubject(p)
                const rowDefinition = definitions.find(
                  (d) => d.id === p.agent_definition_id,
                )
                const active = p.id === selected.id
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-current={active || undefined}
                      onClick={() => onSelect(p.id)}
                      className={cn(
                        'grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_96px_190px_110px] items-center gap-x-3 border-0 border-b border-border px-4 py-2 text-left text-body hover:bg-surface-hover max-md:grid-cols-[minmax(0,1fr)_auto] md:px-6',
                        active ? 'bg-selected' : 'bg-transparent',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">
                          {rowSubject.identifier ? (
                            <span className="mr-2 font-mono text-label text-fg-muted">
                              {rowSubject.identifier}
                            </span>
                          ) : null}
                          {p.title}
                        </span>
                        <span className="block truncate text-label text-fg-muted">
                          {[rowDefinition?.name, rowSubject.context]
                            .filter(Boolean)
                            .join(' · ') || p.summary}
                        </span>
                      </span>
                      <RiskGlyph
                        risk={proposalRisk(p)}
                        className="max-md:hidden"
                      />
                      <Status
                        tone={statusTone(p, rowStage)}
                        className="max-md:hidden"
                      >
                        {proposalStatusLabel(p, rowStage, nameOf)}
                      </Status>
                      <span className="num text-label text-fg-muted max-md:hidden">
                        {shortStamp(p.created_at)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <aside
        aria-label="Proposal"
        className="flex w-[400px] shrink-0 flex-col overflow-auto border-l border-border bg-surface max-lg:hidden"
      >
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <div className="font-mono text-label text-fg-muted">
            {[
              selected.display_id,
              definition && run
                ? `${definition.display_id} run #${run.run_number}`
                : definition?.display_id,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <h2 className="m-0 break-words font-heading text-doc font-semibold">
            {selected.title}
          </h2>
          <Status tone={statusTone(selected, stage)}>
            {proposalStatusLabel(selected, stage, nameOf)}
          </Status>
          {selected.status === 'failed' && selected.error_message ? (
            <Notice tone="bad" title={selected.error_code ?? 'Failed'}>
              {selected.error_message}
            </Notice>
          ) : null}
          {error ? <Notice tone="bad">{error}</Notice> : null}
          {mayDecide ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() =>
                    selected.signature_required
                      ? setSigning(true)
                      : onApprove(selected, null)
                  }
                >
                  {selected.signature_required
                    ? 'Sign, approve and execute'
                    : 'Approve and execute'}
                </Button>
                {subject.identifier ? (
                  <a
                    href={`/${subject.identifier.startsWith('DS-') ? 'datasets' : 'experiments'}/${subject.identifier}`}
                    className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-body text-fg hover:bg-surface-hover"
                  >
                    Edit before approving
                  </a>
                ) : null}
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setRejecting((open) => !open)}
                >
                  Reject…
                </Button>
              </div>
              {rejecting ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    aria-label="Rejection reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Say why. The agent is told."
                  />
                  <div>
                    <Button
                      variant="danger"
                      disabled={!reason.trim() || busy}
                      onClick={() => onReject(selected, reason.trim())}
                    >
                      Reject proposal
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : selected.status === 'approved' && canApproveProposal(selected) ? (
            <div>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => onExecute(selected)}
              >
                Execute approved change
              </Button>
            </div>
          ) : stage === 'waiting' ? (
            <Muted>
              This is {approverName ? `${approverName}’s` : 'an approver’s'} to
              decide.
            </Muted>
          ) : selected.status === 'rejected' ? (
            <Muted>
              Rejected by{' '}
              {nameOf(selected.rejected_by_user_id) ?? 'a colleague'}
              {selected.rejection_reason
                ? `: ${selected.rejection_reason}`
                : '.'}
            </Muted>
          ) : selected.approved_by_user_id ? (
            <Muted>
              Approved by{' '}
              {nameOf(selected.approved_by_user_id) ?? 'a colleague'}
              {selected.approved_at
                ? ` · ${shortStamp(selected.approved_at)}`
                : ''}
              {selected.approval_meaning
                ? ` · signed “${selected.approval_meaning}”`
                : ''}
            </Muted>
          ) : null}
        </div>

        <Section title="Proposed change">
          {rendered ? (
            <RenderedBlock rendered={rendered} />
          ) : selected.preview.changes.length ? (
            <div className="flex flex-col gap-2">
              {selected.preview.changes.map((change) => (
                <div key={change.path} className="flex flex-col gap-1">
                  <code className="text-label font-medium">{change.path}</code>
                  <CodeBlock
                    code={JSON.stringify(change.after, null, 2)}
                    label={`${change.path} after`}
                    maxHeight="sm"
                  />
                </div>
              ))}
            </div>
          ) : (
            <Muted>{selected.summary}</Muted>
          )}
        </Section>

        {evidence.evidence.length ? (
          <Section title="Evidence">
            <DescriptionList
              labelWidth={104}
              items={[
                ...evidence.evidence.map(
                  (item): [React.ReactNode, React.ReactNode] => [
                    item.label,
                    item.href ? (
                      <a href={item.href} className="text-link">
                        {item.value}
                      </a>
                    ) : (
                      linkifyIdentifiers(item.value)
                    ),
                  ],
                ),
                ...(evidence.confidence
                  ? ([
                      [
                        'Confidence',
                        <div key="confidence">
                          <RiskGlyph risk={evidence.confidence.level} />
                          <p className="m-0 mt-0.5 text-fg-muted">
                            {evidence.confidence.note}
                          </p>
                        </div>,
                      ],
                    ] as [React.ReactNode, React.ReactNode][])
                  : []),
              ]}
            />
          </Section>
        ) : null}

        <Section title="Why it needs approval">
          <DescriptionList
            labelWidth={104}
            items={[
              ['Action', actionLabel(selected.operation_kind)],
              [
                'Policy',
                <span key="policy" className="inline-flex items-center gap-1">
                  <Icon name="user" size={12} />
                  {policyLabel(selected)}
                </span>,
              ],
              [
                'Approver',
                approverName
                  ? `${approverName}${evidence.approverRole ? ` (${evidence.approverRole})` : ''}`
                  : 'Anyone who can edit the record',
              ],
              ['Target', subject.label ?? '—'],
              ['Requested', shortStamp(selected.created_at)],
            ]}
          />
          {selected.status === 'pending' && subject.identifier ? (
            <p className="m-0 mt-2 text-label text-fg-muted">
              Checked again when you approve. If {subject.identifier} has
              changed since {revision ?? 'it was proposed'}, nothing is written
              and the agent is asked to propose again.
            </p>
          ) : null}
        </Section>

        <details className="border-t border-border px-4 py-3">
          <summary className="cursor-pointer text-label font-medium text-fg-muted">
            Technical details
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            <DescriptionList
              labelWidth={100}
              className="[overflow-wrap:anywhere]"
              items={[
                ['Operation', agentOperationLabel(selected.operation_kind)],
                ['Risk class', selected.risk_class.replace(/_/g, ' ')],
                ['Policy', selected.approval_policy.replace(/_/g, ' ')],
                ['Agent', selected.provenance.agentId],
                [
                  'Tool',
                  [
                    selected.provenance.tool.name,
                    selected.provenance.tool.version,
                  ]
                    .filter(Boolean)
                    .join(' '),
                ],
                [
                  'Model',
                  `${selected.provenance.model.provider} / ${selected.provenance.model.name}`,
                ],
              ]}
            />
            <p className="m-0 text-label text-fg-muted">
              {selected.policy_reason}
            </p>
            <div>
              <div className="mb-1 text-label font-medium">
                Events ({events.length})
              </div>
              {events.length ? (
                <ol className="m-0 flex list-none flex-col gap-1 p-0">
                  {events.map((e) => (
                    <li key={e.id} className="text-label">
                      <span className="font-medium">
                        {e.event_type.replace(/_/g, ' ')}
                      </span>{' '}
                      <span className="text-fg-muted">
                        {formatNotebookDateTime(e.created_at, { zone: true })}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <Muted>No events yet.</Muted>
              )}
            </div>
          </div>
        </details>
      </aside>

      <ConfirmDialog open={signing} onOpenChange={setSigning}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>Sign to approve</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              This proposal’s policy needs an electronic signature to approve.
              Approving then runs the change.
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <Field
            label="Signature meaning"
            required
            hint="You must have certified your electronic signature."
          >
            <Input
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
            />
          </Field>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel />
            <Button
              variant="primary"
              disabled={!meaning.trim() || busy}
              onClick={() => {
                setSigning(false)
                onApprove(selected, meaning.trim())
              }}
            >
              Sign and approve
            </Button>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border px-4 py-3">
      <h3 className="m-0 mb-2 text-body font-semibold">{title}</h3>
      {children}
    </section>
  )
}
