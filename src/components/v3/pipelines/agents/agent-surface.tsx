import { Fragment, useEffect, useState } from 'react'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Textarea } from '#/components/v3/inventory/list'
import { NativeSelect } from '#/components/v3/projects/select'
import { agentOperationLabel } from '#/lib/agent-operations'
import type {
  AgentOperationEvent,
  AgentOperationPolicy,
  AgentOperationPolicyTargetType,
  AgentOperationProposal,
} from '#/lib/agent-operations'
import type {
  AgentWorkflow,
  AgentWorkflowEvent,
  AgentWorkflowStep,
} from '#/lib/agent-workflows'
import type { AgentPolicyCredentialOption } from './agents-data'

/**
 * UI port (roadmap-4/ui-app3): the agent surface folded into /pipelines/agents
 * (DEC-03, PIPE-01). Reads the real agent operation proposals, workflows and
 * policies through the existing RLS-filtered RPCs and keeps the human
 * approve / reject / execute and advance / resume / cancel controls.
 */

function proposalTone(status: string): Tone {
  switch (status) {
    case 'approved':
      return 'ok'
    case 'executing':
      return 'progress'
    case 'succeeded':
      return 'ok'
    case 'failed':
      return 'bad'
    case 'rejected':
      return 'bad'
    case 'cancelled':
      return 'stored'
    default:
      return 'draft'
  }
}

function workflowTone(status: string): Tone {
  switch (status) {
    case 'waiting_approval':
      return 'review'
    case 'paused':
      return 'warn'
    case 'succeeded':
      return 'ok'
    case 'cancelled':
      return 'stored'
    case 'budget_exhausted':
      return 'bad'
    default:
      return 'draft'
  }
}

function stepTone(status: string): Tone {
  switch (status) {
    case 'succeeded':
      return 'ok'
    case 'waiting_approval':
      return 'review'
    case 'rejected':
      return 'bad'
    case 'failed':
      return 'bad'
    case 'cancelled':
      return 'stored'
    default:
      return 'draft'
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function JsonValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="text-label font-medium text-fg-muted">{label}</div>
      <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-muted p-2 text-[11px] leading-4">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** Group proposals the way the design does: what needs you, what waits on
 * others, and what is already decided. */
export function proposalGroups(
  proposals: AgentOperationProposal[],
  canApprove: boolean,
): { key: string; label: string; items: AgentOperationProposal[] }[] {
  const needsYou: AgentOperationProposal[] = []
  const waiting: AgentOperationProposal[] = []
  const decided: AgentOperationProposal[] = []
  for (const p of proposals) {
    if (p.status === 'pending') (canApprove ? needsYou : waiting).push(p)
    else decided.push(p)
  }
  return [
    { key: 'needs', label: 'Needs your approval', items: needsYou },
    { key: 'waiting', label: 'Waiting on others', items: waiting },
    { key: 'decided', label: 'Decided', items: decided },
  ].filter((g) => g.items.length)
}

export function AgentProposalsPanel({
  proposals,
  events,
  selectedId,
  onSelect,
  onApprove,
  onReject,
  onExecute,
  canApprove,
  pendingAction,
}: {
  proposals: AgentOperationProposal[]
  events: AgentOperationEvent[]
  selectedId: string | null
  onSelect: (id: string) => void
  onApprove: (proposal: AgentOperationProposal) => void
  onReject: (proposal: AgentOperationProposal, reason: string) => void
  onExecute: (proposal: AgentOperationProposal) => void
  canApprove: boolean
  pendingAction: 'approve' | 'reject' | 'execute' | null
}) {
  const selected =
    proposals.find((p) => p.id === selectedId) ?? proposals.at(0) ?? null
  const [reason, setReason] = useState('')
  useEffect(() => setReason(''), [selected?.id])

  if (!selected) {
    return (
      <EmptyState
        icon="pipeline"
        title="No operation proposals"
        body="Agent tools submit typed proposals through the Sheetbase API. Each appears here with its exact impact before any mutation."
      />
    )
  }

  const canDecide = selected.status === 'pending'
  const canExecute = selected.status === 'approved'

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <Table aria-label="Operation proposals">
          <TableHeader>
            <TableRow>
              <TableHead>Proposal</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposalGroups(proposals, canApprove).map((group) => (
              <Fragment key={group.key}>
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="bg-surface-muted text-label font-medium text-fg-muted"
                  >
                    {group.label}
                    <span className="num ml-1.5 font-normal">
                      {group.items.length}
                    </span>
                  </TableCell>
                </TableRow>
                {group.items.map((p) => (
                  <TableRow
                    key={p.id}
                    selected={p.id === selected.id}
                    className="cursor-pointer"
                    onClick={() => onSelect(p.id)}
                  >
                    <TableCell
                      className={
                        p.id === selected.id ? 'font-medium' : undefined
                      }
                    >
                      {p.title}
                    </TableCell>
                    <TableCell>
                      {agentOperationLabel(p.operation_kind)}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {p.risk_class.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell>
                      <Status tone={proposalTone(p.status)}>
                        {statusLabel(p.status)}
                      </Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {p.created_at.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      <Inspector label="Proposal" className="w-[360px]">
        <InspectorSection>
          <div className="flex flex-wrap items-center gap-1.5">
            <Status tone={proposalTone(selected.status)}>
              {statusLabel(selected.status)}
            </Status>
            <Badge variant="kind">Agent-produced</Badge>
            <Badge variant="kind">
              {selected.approval_policy.replace(/_/g, ' ')}
            </Badge>
          </div>
          <div className="mt-1 font-heading text-doc font-semibold">
            {selected.title}
          </div>
          <Muted>{selected.summary}</Muted>
        </InspectorSection>

        {selected.status === 'failed' && selected.error_message ? (
          <Notice tone="bad" title={selected.error_code ?? 'Failed'}>
            {selected.error_message}
          </Notice>
        ) : null}

        {canApprove ? (
          <InspectorSection title="Decision">
            {canExecute ? (
              <Button
                variant="primary"
                onClick={() => onExecute(selected)}
                disabled={pendingAction !== null}
              >
                Execute approved operation
              </Button>
            ) : canDecide ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    onClick={() => onApprove(selected)}
                    disabled={pendingAction !== null}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => onReject(selected, reason)}
                    disabled={!reason.trim() || pendingAction !== null}
                  >
                    Reject
                  </Button>
                </div>
                <Textarea
                  aria-label="Rejection reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason required to reject"
                />
              </div>
            ) : (
              <Muted>No decision is available for this proposal.</Muted>
            )}
          </InspectorSection>
        ) : (
          <InspectorSection title="Decision">
            <Muted>
              Your role can inspect this proposal but cannot approve its
              canonical operation.
            </Muted>
          </InspectorSection>
        )}

        <InspectorSection title="Policy decision and impact">
          <p className="m-0 text-body">{selected.policy_reason}</p>
          <DescriptionList
            labelWidth={110}
            items={[
              ['Target', selected.impact.target.label],
              ['Rows', String(selected.impact.affectedRows)],
              ['Creates draft', selected.impact.createsDraft ? 'Yes' : 'No'],
              ['Mutation', selected.impact.mutationClass],
            ]}
          />
        </InspectorSection>

        <InspectorSection title="Proposed diff">
          <div className="flex flex-col gap-2">
            {selected.preview.changes.map((change) => (
              <div key={change.path} className="flex flex-col gap-1">
                <code className="text-label font-medium">{change.path}</code>
                <div className="grid gap-2 md:grid-cols-2">
                  <JsonValue label="Before" value={change.before} />
                  <JsonValue label="After" value={change.after} />
                </div>
              </div>
            ))}
          </div>
        </InspectorSection>

        <InspectorSection title="Agent provenance">
          <DescriptionList
            labelWidth={100}
            items={[
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
        </InspectorSection>

        <InspectorSection title={`Events (${events.length})`}>
          {events.length ? (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {events.map((e) => (
                <li key={e.id} className="text-label">
                  <span className="font-medium">
                    {statusLabel(e.event_type)}
                  </span>{' '}
                  <span className="text-fg-muted">
                    {e.created_at.slice(0, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Muted>No events yet.</Muted>
          )}
        </InspectorSection>
      </Inspector>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export function AgentWorkflowsPanel({
  workflows,
  steps,
  events,
  proposals,
  selectedId,
  onSelect,
  onAdvance,
  onResume,
  onCancel,
  onInspectProposal,
  pendingAction,
}: {
  workflows: AgentWorkflow[]
  steps: AgentWorkflowStep[]
  events: AgentWorkflowEvent[]
  proposals: AgentOperationProposal[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdvance: (workflow: AgentWorkflow) => void
  onResume: (workflow: AgentWorkflow) => void
  onCancel: (workflow: AgentWorkflow, reason: string) => void
  onInspectProposal: (proposalId: string) => void
  pendingAction: 'advance' | 'resume' | 'cancel' | null
}) {
  const selected =
    workflows.find((w) => w.id === selectedId) ?? workflows.at(0) ?? null
  const [reason, setReason] = useState('')
  useEffect(() => setReason(''), [selected?.id])

  if (!selected) {
    return (
      <EmptyState
        icon="pipeline"
        title="No agent workflows"
        body="Agent workflows appear here with their plan, step outcomes and budget as they run."
      />
    )
  }

  const terminal =
    selected.status === 'succeeded' ||
    selected.status === 'cancelled' ||
    selected.status === 'budget_exhausted'

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <Table aria-label="Agent workflows">
          <TableHeader>
            <TableRow>
              <TableHead>Goal</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Step</TableHead>
              <TableHead align="right">Operations</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workflows.map((w) => (
              <TableRow
                key={w.id}
                selected={w.id === selected.id}
                className="cursor-pointer"
                onClick={() => onSelect(w.id)}
              >
                <TableCell
                  className={w.id === selected.id ? 'font-medium' : undefined}
                >
                  {w.goal}
                </TableCell>
                <TableCell>
                  <Status tone={workflowTone(w.status)}>
                    {statusLabel(w.status)}
                  </Status>
                </TableCell>
                <TableCell align="right">
                  {w.current_step + 1} / {w.plan.steps.length}
                </TableCell>
                <TableCell align="right">
                  {w.used_operations} / {w.max_operations}
                </TableCell>
                <TableCell className="text-fg-muted">
                  {w.created_at.slice(0, 16).replace('T', ' ')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Inspector label="Workflow" className="w-[360px]">
        <InspectorSection>
          <Status tone={workflowTone(selected.status)}>
            {statusLabel(selected.status)}
          </Status>
          <div className="mt-1 font-heading text-doc font-semibold">
            {selected.goal}
          </div>
          <span className="mono text-label text-fg-muted">
            Plan {selected.plan_digest.slice(0, 12)}
          </span>
        </InspectorSection>

        {selected.status === 'paused' ? (
          <Notice tone="warn">
            The current proposal failed or was rejected. Resume creates a new
            proposal for the same pinned operation under a fresh idempotency
            key; completed steps keep their results.
          </Notice>
        ) : null}
        {selected.status === 'cancelled' ? (
          <Notice tone="info">
            Cancelled
            {selected.cancellation_reason
              ? `: ${selected.cancellation_reason}`
              : ''}
            . Completed steps keep their results; unfinished steps are terminal.
          </Notice>
        ) : null}

        {!terminal ? (
          <InspectorSection title="Actions">
            <div className="flex flex-col gap-2">
              {selected.status === 'waiting_approval' ? (
                <Button
                  onClick={() => onAdvance(selected)}
                  disabled={pendingAction !== null}
                >
                  Check step outcome
                </Button>
              ) : null}
              {selected.status === 'paused' ? (
                <Button
                  onClick={() => onResume(selected)}
                  disabled={pendingAction !== null}
                >
                  Resume exact step
                </Button>
              ) : null}
              <Textarea
                aria-label="Workflow cancellation reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason required to cancel"
              />
              <Button
                variant="danger"
                aria-label="Cancel workflow"
                onClick={() => onCancel(selected, reason)}
                disabled={!reason.trim() || pendingAction !== null}
              >
                Cancel workflow
              </Button>
            </div>
          </InspectorSection>
        ) : null}

        <InspectorSection title={`Steps (${steps.length})`}>
          {steps.length ? (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {steps.map((s) => (
                <li key={s.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-label text-fg-muted">
                      {s.position + 1}.
                    </span>
                    <span className="text-body font-medium">{s.title}</span>
                    <Status tone={stepTone(s.status)}>
                      {statusLabel(s.status)}
                    </Status>
                  </div>
                  <span className="text-label text-fg-muted">{s.summary}</span>
                  {s.proposal_id ? (
                    <button
                      type="button"
                      className="cursor-pointer self-start border-0 bg-transparent p-0 text-label text-link hover:underline"
                      onClick={() => onInspectProposal(s.proposal_id!)}
                    >
                      Open proposal
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <Muted>No steps recorded yet.</Muted>
          )}
        </InspectorSection>

        <InspectorSection title="Budget">
          <DescriptionList
            labelWidth={110}
            items={[
              [
                'Operations',
                `${selected.used_operations} / ${selected.max_operations}`,
              ],
              ['Tokens', `${selected.used_tokens} / ${selected.max_tokens}`],
              [
                'Cost (µUSD)',
                `${selected.used_cost_microusd} / ${selected.max_cost_microusd}`,
              ],
            ]}
          />
        </InspectorSection>

        <InspectorSection title={`Events (${events.length})`}>
          {events.length ? (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {events.map((e) => (
                <li key={e.id} className="text-label">
                  <span className="font-medium">
                    {statusLabel(e.event_type)}
                  </span>{' '}
                  <span className="text-fg-muted">
                    {e.created_at.slice(0, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Muted>No events yet.</Muted>
          )}
        </InspectorSection>

        {proposals.length ? (
          <InspectorSection title="Related proposals">
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {proposals.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-left text-label text-link hover:underline"
                    onClick={() => onInspectProposal(p.id)}
                  >
                    {p.title}
                  </button>
                </li>
              ))}
            </ul>
          </InspectorSection>
        ) : null}
      </Inspector>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const TARGET_TYPES: {
  value: AgentOperationPolicyTargetType
  label: string
}[] = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'project', label: 'Project' },
  { value: 'dataset', label: 'Dataset' },
]

export function AgentPoliciesPanel({
  policies,
  credentials,
  canManage,
  onCreate,
  onDisable,
}: {
  policies: AgentOperationPolicy[]
  credentials: AgentPolicyCredentialOption[]
  canManage: boolean
  onCreate: (input: {
    name: string
    credentialId: string
    targetType: AgentOperationPolicyTargetType
    targetId: string | null
    maxAffectedRows: number
    reason: string
    meaning: string
  }) => void
  onDisable: (policy: AgentOperationPolicy) => void
}) {
  const [name, setName] = useState('')
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '')
  const [targetType, setTargetType] =
    useState<AgentOperationPolicyTargetType>('dataset')
  const [targetId, setTargetId] = useState('')
  const [maxRows, setMaxRows] = useState('100')
  const [reason, setReason] = useState('')
  const [meaning, setMeaning] = useState('I approve this delegation')

  useEffect(() => {
    if (!credentialId && credentials[0]) setCredentialId(credentials[0].id)
  }, [credentialId, credentials])

  const limit = Number(maxRows)
  const valid =
    name.trim().length > 0 &&
    credentialId.length > 0 &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    limit <= 1000 &&
    reason.trim().length > 0 &&
    meaning.trim().length > 0

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 md:px-6">
      <Section title="Execution policies" count={policies.length}>
        <Muted>
          Dataset row commits require a human by default. An owner or Data
          Steward can delegate create and append writes for one service
          credential, a canonical target and a row limit. Updates, overwrites
          and other credentials stay human-required.
        </Muted>
        {canManage ? (
          <form
            className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_150px_1fr_100px_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (!valid) return
              onCreate({
                name: name.trim(),
                credentialId,
                targetType,
                targetId: targetType === 'workspace' ? null : targetId.trim(),
                maxAffectedRows: limit,
                reason: reason.trim(),
                meaning: meaning.trim(),
              })
              setName('')
              setTargetId('')
              setReason('')
            }}
          >
            <Field label="Policy name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Assay import rows"
              />
            </Field>
            <Field label="Credential" required>
              <NativeSelect
                value={credentialId}
                onChange={(e) => setCredentialId(e.target.value)}
              >
                {credentials.length === 0 ? (
                  <option value="">No credentials</option>
                ) : null}
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.displayPrefix})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Target">
              <NativeSelect
                value={targetType}
                onChange={(e) =>
                  setTargetType(
                    e.target.value as AgentOperationPolicyTargetType,
                  )
                }
              >
                {TARGET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Target id">
              <Input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={targetType === 'workspace'}
                placeholder={
                  targetType === 'workspace'
                    ? 'Whole workspace'
                    : 'Canonical id'
                }
              />
            </Field>
            <Field label="Max rows">
              <Input
                type="number"
                min={1}
                max={1000}
                value={maxRows}
                onChange={(e) => setMaxRows(e.target.value)}
              />
            </Field>
            <Field label="Reason for change" required>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Assay import rows"
              />
            </Field>
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
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={!valid}>
                Create policy
              </Button>
            </div>
          </form>
        ) : (
          <Muted>
            Only a workspace owner or Data Steward can change policies.
          </Muted>
        )}
        {policies.length ? (
          <TableBox>
            <Table aria-label="Execution policies">
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Credential</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="py-1.5 leading-[17px]">
                      <span className="block font-medium">{p.name}</span>
                      {p.reason ? (
                        <span className="block text-label text-fg-muted">
                          {p.reason}
                        </span>
                      ) : null}
                      {p.signed_at ? (
                        <span className="block text-label text-fg-muted">
                          Signed {p.signed_at.slice(0, 10)}
                          {p.signed_meaning ? ` · ${p.signed_meaning}` : ''}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {credentials.find((c) => c.id === p.credential_id)
                        ?.name ?? p.credential_id}
                    </TableCell>
                    <TableCell>
                      {p.target_type}
                      {p.target_id ? ` · ${p.target_id}` : ''}
                    </TableCell>
                    <TableCell>
                      {String(
                        p.limits.maxAffectedRows ??
                          p.limits.max_affected_rows ??
                          '—',
                      )}
                    </TableCell>
                    <TableCell>
                      <Status tone={p.enabled ? 'ok' : 'stored'}>
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </Status>
                    </TableCell>
                    <TableCell align="right">
                      {canManage && p.enabled ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => onDisable(p)}
                        >
                          Disable
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            icon="pipeline"
            title="No execution policies"
            body="Every dataset row commit requires a human until a policy delegates it."
          />
        )}
      </Section>
    </div>
  )
}
