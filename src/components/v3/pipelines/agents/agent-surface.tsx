import { t } from '#/copy'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { Button, buttonVariants } from '#/components/v3/ui/button'
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
import { Select } from '#/components/v3/ui/select'
import type {
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
        title={t('data.agentSurface.agentWorkflows')}
        description={t('data.agentSurface.workflowAppearsHereWhen')}
      />
    )
  }

  const terminal =
    selected.status === 'succeeded' ||
    selected.status === 'cancelled' ||
    selected.status === 'budget_exhausted'

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <Table aria-label={t('data.agentSurface.ariaAgentWorkflows')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('data.agentSurface.goal')}</TableHead>
              <TableHead>{t('data.agentSurface.status')}</TableHead>
              <TableHead align="right">{t('data.agentSurface.step')}</TableHead>
              <TableHead align="right">
                {t('data.agentSurface.operations')}
              </TableHead>
              <TableHead>{t('data.agentSurface.created')}</TableHead>
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
                  {formatNotebookDateTime(w.created_at, { zone: true })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Inspector label={t('data.agentSurface.workflow')} className="w-[360px]">
        <InspectorSection>
          <Status tone={workflowTone(selected.status)}>
            {statusLabel(selected.status)}
          </Status>
          <div className="mt-1 font-heading text-doc font-semibold">
            {selected.goal}
          </div>
          <span className="mono text-label text-fg-muted">
            {t('data.agentSurface.plan', {
              slice: selected.plan_digest.slice(0, 12),
            })}
          </span>
        </InspectorSection>

        {selected.status === 'paused' ? (
          <Notice tone="warn">
            {t('data.agentSurface.currentProposalFailedRejected')}
          </Notice>
        ) : null}
        {selected.status === 'cancelled' ? (
          <Notice tone="info">
            {t('data.agentSurface.cancelled')}
            {selected.cancellation_reason
              ? `: ${selected.cancellation_reason}`
              : ''}
            {t('data.agentSurface.completedStepsKeepTheir')}
          </Notice>
        ) : null}

        {!terminal ? (
          <InspectorSection title={t('data.agentSurface.actions')}>
            <div className="flex flex-col gap-2">
              {selected.status === 'waiting_approval' ? (
                <Button
                  onClick={() => onAdvance(selected)}
                  disabled={pendingAction !== null}
                >
                  {t('data.agentSurface.checkStepOutcome')}
                </Button>
              ) : null}
              {selected.status === 'paused' ? (
                <Button
                  onClick={() => onResume(selected)}
                  disabled={pendingAction !== null}
                >
                  {t('data.agentSurface.resumeExactStep')}
                </Button>
              ) : null}
              <Textarea
                aria-label={t(
                  'data.agentSurface.ariaWorkflowCancellationReason',
                )}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t(
                  'data.agentSurface.placeholderReasonRequiredCancel',
                )}
              />
              <Button
                variant="danger"
                aria-label={t('data.agentSurface.cancelWorkflow')}
                onClick={() => onCancel(selected, reason)}
                disabled={!reason.trim() || pendingAction !== null}
              >
                {t('data.agentSurface.cancelWorkflow')}
              </Button>
            </div>
          </InspectorSection>
        ) : null}

        <InspectorSection
          title={t('data.agentSurface.steps', { length: steps.length })}
        >
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
                      {t('data.agentSurface.openProposal')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <Muted>{t('data.agentSurface.stepsRecordedYet')}</Muted>
          )}
        </InspectorSection>

        <InspectorSection title={t('data.agentSurface.budget')}>
          <DescriptionList
            labelWidth={110}
            items={[
              [
                t('data.agentSurface.operations'),
                `${selected.used_operations} / ${selected.max_operations}`,
              ],
              [
                t('data.agentSurface.tokens'),
                `${selected.used_tokens} / ${selected.max_tokens}`,
              ],
              [
                t('data.agentSurface.costUsd'),
                `${selected.used_cost_microusd} / ${selected.max_cost_microusd}`,
              ],
            ]}
          />
        </InspectorSection>

        <InspectorSection
          title={t('data.agentSurface.events', { length: events.length })}
        >
          {events.length ? (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {events.map((e) => (
                <li key={e.id} className="text-label">
                  <span className="font-medium">
                    {statusLabel(e.event_type)}
                  </span>{' '}
                  <span className="text-fg-muted">
                    {formatNotebookDateTime(e.created_at, { zone: true })}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Muted>{t('data.agentSurface.eventsYet')}</Muted>
          )}
        </InspectorSection>

        {proposals.length ? (
          <InspectorSection title={t('data.agentSurface.relatedProposals')}>
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
  { value: 'workspace', label: t('data.agentSurface.workspace') },
  { value: 'project', label: t('data.agentSurface.project') },
  { value: 'dataset', label: t('data.agentSurface.dataset') },
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
  /** The empty state's one action puts the cursor in the field that starts it. */
  const nameRef = useRef<HTMLInputElement>(null)
  const [credentialId, setCredentialId] = useState(credentials[0]?.id ?? '')
  const [targetType, setTargetType] =
    useState<AgentOperationPolicyTargetType>('dataset')
  const [targetId, setTargetId] = useState('')
  const [maxRows, setMaxRows] = useState('100')
  const [reason, setReason] = useState('')
  const [meaning, setMeaning] = useState(
    t('data.agentSurface.iApproveDelegation'),
  )
  /** PIPE-01: disabling removes a delegation, so it is confirmed first. */
  const [pendingDisable, setPendingDisable] =
    useState<AgentOperationPolicy | null>(null)

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
      <Section
        title={t('data.agentSurface.executionPolicies')}
        count={policies.length}
      >
        <Muted>{t('data.agentSurface.addingRowsDatasetNeeds')}</Muted>
        {/* PIPE-01: with no service credential there is nothing to delegate to,
            so the form stays disabled — and now says why. */}
        {canManage && credentials.length === 0 ? (
          <Notice
            tone="warn"
            title={t('data.agentSurface.serviceCredentials')}
            action={
              <Link
                to="/settings/api"
                className={buttonVariants({ variant: 'quiet', size: 'sm' })}
              >
                {t('data.agentSurface.openApiSdk')}
              </Link>
            }
          >
            {t('data.agentSurface.policyDelegatesDatasetRow')}
          </Notice>
        ) : null}
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
            <Field label={t('data.agentSurface.policyName')} required>
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('data.agentSurface.placeholderAssayImportRows')}
              />
            </Field>
            <Field label={t('data.agentSurface.credential')} required>
              <Select
                value={credentialId}
                onChange={(e) => setCredentialId(e.target.value)}
              >
                {credentials.length === 0 ? (
                  <option value="">
                    {t('data.agentSurface.noCredentials')}
                  </option>
                ) : null}
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.displayPrefix})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('data.agentSurface.target')}>
              <Select
                value={targetType}
                onChange={(e) =>
                  setTargetType(
                    e.target.value as AgentOperationPolicyTargetType,
                  )
                }
              >
                {TARGET_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('data.agentSurface.targetId')}>
              <Input
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={targetType === 'workspace'}
                placeholder={
                  targetType === 'workspace'
                    ? t('data.agentSurface.placeholderWholeWorkspace')
                    : t('data.agentSurface.placeholderCanonicalId')
                }
              />
            </Field>
            <Field label={t('data.agentSurface.maxRows')}>
              <Input
                type="number"
                min={1}
                max={1000}
                value={maxRows}
                onChange={(e) => setMaxRows(e.target.value)}
              />
            </Field>
            <Field label={t('data.agentSurface.reasonChange')} required>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('data.agentSurface.placeholderEGAssayImport')}
              />
            </Field>
            <Field
              label={t('data.agentSurface.signatureMeaning')}
              required
              hint={t('data.agentSurface.mustHaveCertifiedElectronic')}
            >
              <Input
                value={meaning}
                onChange={(e) => setMeaning(e.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={!valid}>
                {t('data.agentSurface.createPolicy')}
              </Button>
            </div>
          </form>
        ) : (
          <Muted>{t('data.agentSurface.onlyWorkspaceOwnerData')}</Muted>
        )}
        {policies.length ? (
          <TableBox>
            <Table aria-label={t('data.agentSurface.executionPolicies')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('data.agentSurface.policy')}</TableHead>
                  <TableHead>{t('data.agentSurface.credential')}</TableHead>
                  <TableHead>{t('data.agentSurface.target')}</TableHead>
                  <TableHead>{t('data.agentSurface.limit')}</TableHead>
                  <TableHead>{t('data.agentSurface.enabled')}</TableHead>
                  <TableHead aria-label={t('data.agentSurface.actions')} />
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
                          {t('data.agentSurface.signed', {
                            value: formatNotebookDateTime(p.signed_at, {
                              zone: true,
                            }),
                          })}
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
                        {p.enabled
                          ? t('data.agentSurface.enabled')
                          : t('data.agentSurface.disabled')}
                      </Status>
                    </TableCell>
                    <TableCell align="right">
                      {canManage && p.enabled ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setPendingDisable(p)}
                        >
                          {t('data.agentSurface.disable')}
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
            title={t('data.agentSurface.executionPolicies2')}
            description={
              canManage
                ? t('data.agentSurface.everyDatasetRowCommit')
                : t('data.agentSurface.everyDatasetRowCommit2')
            }
            action={
              canManage ? (
                <Button
                  variant="primary"
                  onClick={() => nameRef.current?.focus()}
                >
                  {t('data.agentSurface.createFirstPolicy')}
                </Button>
              ) : undefined
            }
          />
        )}
      </Section>
      <ConfirmDialog
        open={pendingDisable !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisable(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('data.agentSurface.disable')}{' '}
              {pendingDisable?.name ?? t('data.agentSurface.thisPolicy')}?
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('data.agentSurface.datasetRowCommitsCredential')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel />
            <ConfirmDialogAction
              variant="danger-fill"
              onClick={() => {
                const policy = pendingDisable
                setPendingDisable(null)
                if (policy) onDisable(policy)
              }}
            >
              {t('data.agentSurface.disablePolicy')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
