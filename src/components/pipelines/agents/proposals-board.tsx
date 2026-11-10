import { useState } from 'react'

import { t } from '#/copy'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { CodeBlock } from '#/components/ui/code-block'
import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { EmptyState } from '#/components/ui/empty-state'
import { Field, Input } from '#/components/ui/input'
import { Icon } from '#/components/icons'
import { Notice } from '#/components/ui/alert'
import { DescriptionList, Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { Textarea } from '#/components/inventory/list'
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
import { proposalBoardGroups } from './board-data'

export { proposalBoardGroups } from './board-data'

/**
 * The Agents Proposals board: what needs you, what waits on someone else, and
 * what was decided, with the proposed change, its evidence and why it needs
 * approval beside the list. The raw operation stays under Technical details.
 */

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

function RenderedBlock({ rendered }: { rendered: RenderedChange }) {
  const occurrences = new Map<string, number>()

  const sections = rendered.sections.map((section) => {
    const occurrence = occurrences.get(section.title) ?? 0
    occurrences.set(section.title, occurrence + 1)

    return { section, key: `${section.title}-${occurrence}` }
  })

  return (
    <div className="flex flex-col gap-2">
      {sections.map(({ section, key }) =>
        section.kind === 'unchanged' ? (
          <div
            key={key}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-label"
          >
            <span className="min-w-0 truncate">
              <span className="font-medium">{section.title}</span>
              {section.subtitle ? (
                <span className="text-fg-muted"> · {section.subtitle}</span>
              ) : null}
            </span>
            <span className="text-fg-muted">
              {t('data.proposalsBoard.unchanged')}
            </span>
          </div>
        ) : (
          <div
            key={key}
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
                  ? t('data.proposalsBoard.added')
                  : section.kind === 'removed'
                    ? t('data.proposalsBoard.removed')
                    : t('data.proposalsBoard.changed')}
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
  if (proposal.signature_required)
    return t('data.proposalsBoard.needsESignature')

  if (proposal.approval_policy === 'automatic')
    return t('data.proposalsBoard.allowed')

  if (proposal.approval_policy === 'delegated')
    return t('data.proposalsBoard.delegated')

  return t('data.proposalsBoard.needsApproval2')
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

  const [meaning, setMeaning] = useState(() =>
    t('data.proposalsBoard.iApproveProposal'),
  )

  const [previousId, setPreviousId] = useState(selected?.id)

  if (previousId !== selected?.id) {
    setPreviousId(selected?.id)
    setRejecting(false)
    setReason('')
    setSigning(false)
  }

  if (!selected) {
    return (
      <EmptyState
        icon="pipeline"
        title={t('data.proposalsBoard.noProposals')}
        description={t('data.proposalsBoard.whenWorkflowProposesChange')}
      />
    )
  }

  const stage = proposalStage(selected, me)

  const definition = definitions.find(
    (d) => d.id === selected.agent_definition_id,
  )

  const run = runs.find((r) => r.id === selected.agent_run_id)

  const mayDecide =
    stage === 'needs' &&
    selected.status === 'pending' &&
    canApproveProposal(selected)

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
              {group.items.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  stage={group.stage}
                  definitions={definitions}
                  active={p.id === selected.id}
                  onSelect={onSelect}
                  nameOf={nameOf}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <aside
        aria-label={t('data.proposalsBoard.ariaProposal')}
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
          <ProposalFailure proposal={selected} />
          {error ? <Notice tone="bad">{error}</Notice> : null}
          {mayDecide ? (
            <ProposalDecision
              selected={selected}
              busy={busy}
              onApprove={onApprove}
              onReject={onReject}
              onSign={() => setSigning(true)}
              rejecting={rejecting}
              onToggleReject={() => setRejecting((open) => !open)}
              reason={reason}
              onReasonChange={setReason}
            />
          ) : selected.status === 'approved' && canApproveProposal(selected) ? (
            <div>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => onExecute(selected)}
              >
                {t('data.proposalsBoard.executeApprovedChange')}
              </Button>
            </div>
          ) : (
            <ProposalOutcome
              selected={selected}
              stage={stage}
              nameOf={nameOf}
            />
          )}
        </div>

        <ProposalDetails selected={selected} events={events} nameOf={nameOf} />
      </aside>

      <ConfirmDialog open={signing} onOpenChange={setSigning}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('data.proposalsBoard.signApprove')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('data.proposalsBoard.proposalSPolicyNeeds')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <Field
            label={t('data.proposalsBoard.signatureMeaning')}
            required
            hint={t('data.proposalsBoard.mustHaveCertifiedElectronic')}
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
              {t('data.proposalsBoard.signApprove2')}
            </Button>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

function ProposalDetails({
  selected,
  events,
  nameOf,
}: Pick<
  React.ComponentProps<typeof AgentProposalsBoard>,
  'events' | 'nameOf'
> & { selected: AgentOperationProposal }) {
  const subject = proposalSubject(selected)
  const evidence = proposalEvidence(selected)
  const rendered = proposalRendered(selected)
  const approverName = nameOf(selected.approver_user_id)
  const revision = /rev \d+/.exec(subject.label ?? '')?.[0]

  return (
    <>
      <Section title={t('data.proposalsBoard.proposedChange')}>
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
        <Section title={t('data.proposalsBoard.evidence')}>
          <DescriptionList
            labelWidth={104}
            items={[
              ...evidence.evidence.map(
                (item): [React.ReactNode, React.ReactNode] => [
                  item.label,
                  item.href ? (
                    <a key={item.label} href={item.href} className="text-link">
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
                      t('data.proposalsBoard.confidence'),
                      <div key="confidence">
                        <RiskGlyph risk={evidence.confidence.level} />
                        <p className="m-0 mt-0.5 text-fg-muted">
                          {evidence.confidence.note}
                        </p>
                      </div>,
                    ],
                  ] satisfies [React.ReactNode, React.ReactNode][])
                : []),
            ]}
          />
        </Section>
      ) : null}

      <Section title={t('data.proposalsBoard.whyNeedsApproval')}>
        <DescriptionList
          labelWidth={104}
          items={[
            [
              t('data.proposalsBoard.action'),
              actionLabel(selected.operation_kind),
            ],
            [
              t('data.proposalsBoard.policy'),
              <span key="policy" className="inline-flex items-center gap-1">
                <Icon name="user" size={12} />
                {policyLabel(selected)}
              </span>,
            ],
            [
              t('data.proposalsBoard.approver'),
              approverName
                ? `${approverName}${evidence.approverRole ? ` (${evidence.approverRole})` : ''}`
                : t('data.proposalsBoard.anyoneWhoEditRecord'),
            ],
            [t('data.proposalsBoard.target'), subject.label ?? '—'],
            [
              t('data.proposalsBoard.requested'),
              shortStamp(selected.created_at),
            ],
          ]}
        />
        {selected.status === 'pending' && subject.identifier ? (
          <p className="m-0 mt-2 text-label text-fg-muted">
            {t('data.proposalsBoard.checkedAgainWhenApprove', {
              identifier: subject.identifier,
              since: revision ?? t('data.proposalsBoard.itWasProposed'),
            })}
          </p>
        ) : null}
      </Section>

      <details className="border-t border-border px-4 py-3">
        <summary className="cursor-pointer text-label font-medium text-fg-muted">
          {t('data.proposalsBoard.technicalDetails')}
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <DescriptionList
            labelWidth={100}
            className="[overflow-wrap:anywhere]"
            items={[
              [
                t('data.proposalsBoard.operation'),
                agentOperationLabel(selected.operation_kind),
              ],
              [
                t('data.proposalsBoard.riskClass'),
                selected.risk_class.replace(/_/g, ' '),
              ],
              [
                t('data.proposalsBoard.policy'),
                selected.approval_policy.replace(/_/g, ' '),
              ],
              [t('data.proposalsBoard.agent'), selected.provenance.agentId],
              [
                t('data.proposalsBoard.tool'),
                [
                  selected.provenance.tool.name,
                  selected.provenance.tool.version,
                ]
                  .filter(Boolean)
                  .join(' '),
              ],
              [
                t('data.proposalsBoard.model'),
                `${selected.provenance.model.provider} / ${selected.provenance.model.name}`,
              ],
            ]}
          />
          <p className="m-0 text-label text-fg-muted">
            {selected.policy_reason}
          </p>
          <div>
            <div className="mb-1 text-label font-medium">
              {t('data.proposalsBoard.events', { length: events.length })}
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
              <Muted>{t('data.proposalsBoard.eventsYet')}</Muted>
            )}
          </div>
        </div>
      </details>
    </>
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

function ProposalRow({
  proposal: p,
  stage,
  definitions,
  active,
  onSelect,
  nameOf,
}: Pick<
  React.ComponentProps<typeof AgentProposalsBoard>,
  'definitions' | 'onSelect' | 'nameOf'
> & {
  proposal: AgentOperationProposal
  stage: ProposalStage
  active: boolean
}) {
  const subject = proposalSubject(p)
  const definition = definitions.find((d) => d.id === p.agent_definition_id)

  return (
    <li>
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
            {subject.identifier ? (
              <span className="mr-2 font-mono text-label text-fg-muted">
                {subject.identifier}
              </span>
            ) : null}
            {p.title}
          </span>
          <span className="block truncate text-label text-fg-muted">
            {[definition?.name, subject.context].filter(Boolean).join(' · ') ||
              p.summary}
          </span>
        </span>
        <RiskGlyph risk={proposalRisk(p)} className="max-md:hidden" />
        <Status tone={statusTone(p, stage)} className="max-md:hidden">
          {proposalStatusLabel(p, stage, nameOf)}
        </Status>
        <span className="num text-label text-fg-muted max-md:hidden">
          {shortStamp(p.created_at)}
        </span>
      </button>
    </li>
  )
}

function ProposalDecision({
  selected,
  busy,
  onApprove,
  onReject,
  onSign,
  rejecting,
  onToggleReject,
  reason,
  onReasonChange,
}: Pick<
  React.ComponentProps<typeof AgentProposalsBoard>,
  'onApprove' | 'onReject'
> & {
  selected: AgentOperationProposal
  busy: boolean
  onSign: () => void
  rejecting: boolean
  onToggleReject: () => void
  reason: string
  onReasonChange: (reason: string) => void
}) {
  const subject = proposalSubject(selected)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            selected.signature_required ? onSign() : onApprove(selected, null)
          }
        >
          {selected.signature_required
            ? t('data.proposalsBoard.signApproveExecute')
            : t('data.proposalsBoard.approveExecute')}
        </Button>
        {subject.identifier ? (
          <a
            href={`/${subject.identifier.startsWith('DS-') ? 'datasets' : 'experiments'}/${subject.identifier}`}
            className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-body text-fg hover:bg-surface-hover"
          >
            {t('data.proposalsBoard.editBeforeApproving')}
          </a>
        ) : null}
        <Button variant="quiet" disabled={busy} onClick={onToggleReject}>
          {t('data.proposalsBoard.reject')}
        </Button>
      </div>
      {rejecting ? (
        <div className="flex flex-col gap-2">
          <Textarea
            aria-label={t('data.proposalsBoard.ariaRejectionReason')}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder={t('data.proposalsBoard.placeholderSayWhyAgentTold')}
          />
          <div>
            <Button
              variant="danger"
              disabled={!reason.trim() || busy}
              onClick={() => onReject(selected, reason.trim())}
            >
              {t('data.proposalsBoard.rejectProposal')}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function ProposalFailure({ proposal }: { proposal: AgentOperationProposal }) {
  if (proposal.status !== 'failed' || !proposal.error_message) return null

  return (
    <Notice tone="bad" title={proposal.error_code ?? t('common.states.failed')}>
      {proposal.error_message}
    </Notice>
  )
}

function ProposalOutcome({
  selected,
  stage,
  nameOf,
}: Pick<React.ComponentProps<typeof AgentProposalsBoard>, 'nameOf'> & {
  selected: AgentOperationProposal
  stage: ProposalStage
}) {
  const approverName = nameOf(selected.approver_user_id)

  if (stage === 'waiting')
    return (
      <Muted>
        {approverName
          ? t('data.proposalsBoard.waitingOnPerson', { name: approverName })
          : t('data.proposalsBoard.waitingOnApprover')}
      </Muted>
    )

  if (selected.status === 'rejected')
    return (
      <Muted>
        {selected.rejection_reason
          ? t('data.proposalsBoard.rejectedByWithReason', {
              name:
                nameOf(selected.rejected_by_user_id) ??
                t('data.proposalsBoard.aColleague'),
              reason: selected.rejection_reason,
            })
          : t('data.proposalsBoard.rejectedBy', {
              name:
                nameOf(selected.rejected_by_user_id) ??
                t('data.proposalsBoard.aColleague'),
            })}
      </Muted>
    )

  if (!selected.approved_by_user_id) return null

  return (
    <Muted>
      {[
        t('data.proposalsBoard.approvedBy', {
          name:
            nameOf(selected.approved_by_user_id) ??
            t('data.proposalsBoard.aColleague'),
        }),
        selected.approved_at ? shortStamp(selected.approved_at) : null,
        selected.approval_meaning
          ? t('data.proposalsBoard.signed', {
              approvalMeaning: selected.approval_meaning,
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </Muted>
  )
}
