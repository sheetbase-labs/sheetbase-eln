import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { useEffect, useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import {
  POLICY_COLUMNS,
  POLICY_MODES,
  policyModeLabel,
  revisionTitle,
  shortStamp,
} from '#/lib/agent-registry'
import type {
  AgentDefinition,
  AgentPolicy,
  AgentPolicyRevision,
  PolicyMode,
} from '#/lib/agent-registry'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

/**
 * The Agents Policies board: for each workflow, what it may do on its own, with
 * the numbered revisions of that policy beside it. The policy is controlled
 * configuration, so a change needs a reason and an e-signature.
 */

const MODE_ICON: Record<PolicyMode, IconName> = {
  never: 'x',
  allowed: 'check',
  needs_approval: 'user',
  needs_signature: 'lock',
}

function ModeCell({ mode }: { mode: PolicyMode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        mode === 'never' && 'text-fg-muted',
      )}
    >
      <Icon
        name={MODE_ICON[mode]}
        size={13}
        className={mode === 'allowed' ? 'text-success-text' : undefined}
      />
      {policyModeLabel(mode)}
    </span>
  )
}

export function AgentPoliciesBoard({
  definitions,
  revisions,
  initialDefinitionId,
  canChange,
  onChange,
  nameOf,
  projectName,
  pending,
  error,
}: {
  definitions: AgentDefinition[]
  revisions: AgentPolicyRevision[]
  /** Open the change dialog on this workflow (from "Edit policy"). */
  initialDefinitionId?: string | null
  canChange: boolean
  onChange: (input: {
    definition: AgentDefinition
    policy: AgentPolicy
    changeRef: string | null
    reason: string
    meaning: string
  }) => Promise<unknown>
  nameOf: (userId: string | null) => string | null
  projectName: (projectId: string) => string
  pending: boolean
  error?: string | null
}) {
  const [dialogFor, setDialogFor] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (initialDefinitionId && canChange) {
      setDialogFor(initialDefinitionId)
      setOpen(true)
    }
  }, [initialDefinitionId, canChange])
  const latest = revisions.at(0)

  if (definitions.length === 0) {
    return (
      <EmptyState
        icon="lock"
        title="No policies yet"
        description="Each workflow has a policy that says what it may do on its own. They are listed here once a workflow exists."
      />
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted px-4 py-2 text-label md:px-6">
          <span className="min-w-0">
            {latest ? (
              <>
                <span className="font-medium">Revision </span>
                <span className="num font-medium">{latest.revision}</span>
                <span className="text-fg-muted">
                  {' '}
                  · changed by{' '}
                  {nameOf(latest.changed_by_user_id) ?? 'a colleague'},{' '}
                  {formatNotebookDateTime(latest.changed_at)}
                  {latest.change_ref
                    ? ` “${latest.change_ref}: ${latest.reason}”`
                    : ` “${latest.reason}”`}
                </span>
              </>
            ) : (
              <span className="text-fg-muted">No changes recorded yet.</span>
            )}
          </span>
          <Button
            icon="edit"
            disabled={!canChange}
            title={
              canChange ? undefined : 'Workspace admins and QA change policies.'
            }
            onClick={() => {
              setDialogFor(definitions[0]?.id ?? null)
              setOpen(true)
            }}
          >
            Change policy
          </Button>
        </div>

        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="border-b border-border text-left text-label text-fg-muted">
              <th scope="col" className="px-4 py-2 font-normal md:pl-6">
                Workflow
              </th>
              {POLICY_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="px-2 py-2 font-normal max-md:hidden"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => (
              <tr key={d.id} className="border-b border-border">
                <td className="px-4 py-2 md:pl-6">
                  <span className="font-mono text-label text-fg-muted">
                    {d.display_id}
                  </span>{' '}
                  <span className="font-medium">{d.name}</span>
                  <span className="block max-w-[260px] truncate text-label text-fg-muted">
                    {d.project_ids.length
                      ? d.project_ids.map(projectName).join(', ')
                      : 'All projects'}
                  </span>
                </td>
                {POLICY_COLUMNS.map((column) => (
                  <td key={column.key} className="px-2 py-2 max-md:hidden">
                    <ModeCell mode={d.policy[column.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-label md:grid-cols-4 md:px-6">
          {POLICY_MODES.map((m) => (
            <div key={m.mode} className="flex flex-col gap-0.5">
              <dt>
                <ModeCell mode={m.mode} />
              </dt>
              <dd className="m-0 text-fg-muted">{m.help}</dd>
            </div>
          ))}
        </dl>
      </div>

      <aside
        aria-label="About these policies"
        className="flex w-[300px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface px-4 py-3 max-lg:hidden"
      >
        <section>
          <h2 className="m-0 mb-1 text-body font-semibold">
            About these policies
          </h2>
          <p className="m-0 text-label text-fg-muted">
            Each cell says what a workflow may do on its own. The policy is
            controlled configuration: changes need a reason and your
            e-signature, and apply to proposals made after the change.
          </p>
        </section>
        <section>
          <h2 className="m-0 mb-1.5 text-body font-semibold">Changes</h2>
          {revisions.length ? (
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-label">
              {revisions.slice(0, 5).map((r) => (
                <li key={r.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {revisionTitle(r, nameOf)}
                    </span>
                    <span className="num shrink-0 text-fg-muted">
                      {shortStamp(r.changed_at)}
                    </span>
                  </div>
                  <div className="text-fg-muted">
                    {r.summary}
                    {r.change_ref ? ` · ${r.change_ref}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <Muted>No changes yet.</Muted>
          )}
          <p className="m-0 mt-2 text-label text-fg-muted">
            Full detail, with signatures, in the audit log.
          </p>
        </section>
        <section>
          <h2 className="m-0 mb-1 text-body font-semibold">
            Who can change them
          </h2>
          <p className="m-0 text-label text-fg-muted">
            Workspace admins and QA. Owners of a workflow can ask for a change
            but can’t make it.
          </p>
        </section>
      </aside>

      {open ? (
        <ChangePolicyDialog
          definitions={definitions}
          initialId={dialogFor}
          pending={pending}
          error={error}
          onClose={() => setOpen(false)}
          onSubmit={async (input) => {
            await onChange(input)
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function ChangePolicyDialog({
  definitions,
  initialId,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  definitions: AgentDefinition[]
  initialId: string | null
  pending: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (input: {
    definition: AgentDefinition
    policy: AgentPolicy
    changeRef: string | null
    reason: string
    meaning: string
  }) => Promise<unknown>
}) {
  const first = definitions.find((d) => d.id === initialId) ?? definitions[0]
  const [definitionId, setDefinitionId] = useState(first.id)
  const definition = definitions.find((d) => d.id === definitionId) ?? first
  const [policy, setPolicy] = useState<AgentPolicy>(definition.policy)
  const [changeRef, setChangeRef] = useState('')
  const [reason, setReason] = useState('')
  const [meaning, setMeaning] = useState('I approve this change')
  useEffect(() => setPolicy(definition.policy), [definition])
  const changed = POLICY_COLUMNS.some(
    (c) => policy[c.key] !== definition.policy[c.key],
  )
  const valid = changed && reason.trim() && meaning.trim()

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader
          title="Change policy"
          description="A signed, numbered change. It applies to proposals made after it."
        />
        <DialogBody>
          <Field label="Workflow">
            <PickerSelect
              noun="workflow"
              value={definitionId}
              onChange={(id) => setDefinitionId(id)}
              options={definitions.map((d) => ({
                id: d.id,
                identifier: d.display_id,
                label: d.name,
              }))}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {POLICY_COLUMNS.map((column) => (
              <Field key={column.key} label={column.label}>
                <Select
                  value={policy[column.key]}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      [column.key]: e.target.value as PolicyMode,
                    })
                  }
                >
                  {POLICY_MODES.map((m) => (
                    <option key={m.mode} value={m.mode}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <Field
            label="Change reference"
            hint="Your change-control number, if you have one."
          >
            <Input
              value={changeRef}
              onChange={(e) => setChangeRef(e.target.value)}
              placeholder="CC-0232"
            />
          </Field>
          <Field label="Reason for change" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
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
          {error ? <Notice tone="bad">{error}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid || pending}
            onClick={() =>
              void onSubmit({
                definition,
                policy,
                changeRef: changeRef.trim() || null,
                reason: reason.trim(),
                meaning: meaning.trim(),
              })
            }
          >
            Sign and change policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
