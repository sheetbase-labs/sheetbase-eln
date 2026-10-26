import { Link } from '@tanstack/react-router'

import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Muted } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import type { AgentOperationProposal } from '#/lib/agent-operations'
import {
  lastRunLabel,
  lastRunTime,
  policySummary,
  runLine,
  runStatus,
  runsThisWeek,
  shortStamp,
} from '#/lib/agent-registry'
import type { AgentDefinition, AgentRun } from '#/lib/agent-registry'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * The Agents Workflows board: each automation with what starts it, where it
 * works, how its last run went and whether it is on; and beside the list, what
 * the selected one reads, what it may propose and its recent runs.
 */

function triggerIcon(label: string): IconName {
  const text = label.toLowerCase()
  if (/upload/.test(text)) return 'upload'
  if (/mon|tue|wed|thu|fri|sat|sun|daily|weekly|\d{2}:\d{2}/.test(text))
    return 'clock'
  if (/notebook|asked/.test(text)) return 'edit'
  return 'database'
}

function WorkflowId({ id }: { id: string }) {
  return <span className="font-mono">{id}</span>
}

/** Most recently run first, paused workflows last (runs arrive newest first). */
export function workflowOrder(
  definitions: readonly AgentDefinition[],
  runs: readonly AgentRun[],
): AgentDefinition[] {
  const latest = (d: AgentDefinition) =>
    runs.find((r) => r.definition_id === d.id)?.started_at ?? ''
  return [...definitions].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      latest(b).localeCompare(latest(a)),
  )
}

export function AgentWorkflowsBoard({
  definitions: unsorted,
  runs,
  proposals,
  selectedId,
  onSelect,
  onToggle,
  canToggle,
  me,
  nameOf,
  projectName,
  now,
  pending,
  error,
}: {
  definitions: AgentDefinition[]
  runs: AgentRun[]
  proposals: AgentOperationProposal[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (definition: AgentDefinition, enabled: boolean) => void
  canToggle: (definition: AgentDefinition) => boolean
  me: { userId: string | null; canApprove: boolean }
  nameOf: (userId: string | null) => string | null
  projectName: (projectId: string) => string
  now: Date
  pending: boolean
  error?: string | null
}) {
  const definitions = workflowOrder(unsorted, runs)
  const selected =
    definitions.find((d) => d.id === selectedId) ?? definitions.at(0) ?? null
  if (!selected) {
    return (
      <EmptyState
        icon="pipeline"
        title="No agent workflows"
        description="A workflow is an automation that reads your data and proposes changes. Once one is set up it is listed here with its runs."
      />
    )
  }
  const proposalOf = (run: AgentRun | undefined) =>
    run?.proposal_id
      ? proposals.find((p) => p.id === run.proposal_id)
      : undefined
  const projectsOf = (d: AgentDefinition) =>
    d.project_ids.length
      ? d.project_ids.map(projectName).join(', ')
      : 'All projects'
  const lastRun = (d: AgentDefinition) =>
    runs.filter((r) => r.definition_id === d.id)[0]
  const selectedRuns = runs.filter((r) => r.definition_id === selected.id)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="border-b border-border text-left text-label text-fg-muted">
              <th scope="col" className="px-4 py-2 font-normal md:pl-6">
                Workflow
              </th>
              <th scope="col" className="px-2 py-2 font-normal max-md:hidden">
                Starts on
              </th>
              <th scope="col" className="px-2 py-2 font-normal max-lg:hidden">
                Projects
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Last run
              </th>
              <th
                scope="col"
                className="px-2 py-2 text-right font-normal max-md:hidden"
              >
                This week
              </th>
              <th
                scope="col"
                className="px-4 py-2 text-center font-normal md:pr-6"
              >
                On
              </th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => {
              const last = lastRun(d)
              const status = lastRunLabel(d, last, proposalOf(last), me, nameOf)
              const active = d.id === selected.id
              return (
                <tr
                  key={d.id}
                  aria-selected={active}
                  onClick={() => onSelect(d.id)}
                  className={cn(
                    'cursor-pointer border-b border-border hover:bg-surface-hover',
                    active && 'bg-selected',
                  )}
                >
                  <td className="px-4 py-2 md:pl-6">
                    <button
                      type="button"
                      onClick={() => onSelect(d.id)}
                      className="m-0 block cursor-pointer border-0 bg-transparent p-0 text-left text-body font-medium text-fg"
                    >
                      {d.name}
                      {d.kind === 'ai' ? (
                        <Badge variant="kind" className="ml-1.5 align-middle">
                          AI
                        </Badge>
                      ) : null}
                    </button>
                    <span className="block text-label text-fg-muted">
                      {/* Workflows have no page of their own to link to. */}
                      <WorkflowId id={d.display_id} />
                      {nameOf(d.owner_user_id)
                        ? ` · ${nameOf(d.owner_user_id)}`
                        : ''}
                    </span>
                  </td>
                  <td className="px-2 py-2 max-md:hidden">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name={triggerIcon(d.trigger_label)} size={13} />
                      {d.trigger_label}
                    </span>
                  </td>
                  <td className="px-2 py-2 max-lg:hidden">{projectsOf(d)}</td>
                  <td className="px-2 py-2">
                    {status ? (
                      <span className="flex items-center justify-between gap-3">
                        <Status tone={status.tone}>{status.label}</Status>
                        {d.enabled && last ? (
                          <span className="num text-label text-fg-muted max-md:hidden">
                            {lastRunTime(last.started_at, now)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="num px-2 py-2 text-right max-md:hidden">
                    {runsThisWeek(runs, d.id, now)}
                  </td>
                  <td className="px-4 py-2 text-center md:pr-6">
                    <input
                      type="checkbox"
                      aria-label={`${d.name} is on`}
                      checked={d.enabled}
                      disabled={!canToggle(d) || pending}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onToggle(d, e.target.checked)}
                      className="size-3.5 accent-[var(--color-primary)]"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <aside
        aria-label="Workflow"
        className="flex w-[380px] shrink-0 flex-col overflow-auto border-l border-border bg-surface max-lg:hidden"
      >
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
          <div className="font-mono text-label text-fg-muted">
            {selected.display_id} ·{' '}
            {selected.kind === 'ai' ? 'AI assistant' : 'Rule'}
          </div>
          <h2 className="m-0 break-words font-heading text-doc font-semibold">
            {selected.name}
          </h2>
          <p className="m-0 text-body text-fg-muted">{selected.description}</p>
          {error ? <Muted className="text-danger-text">{error}</Muted> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={selected.enabled ? 'pause' : 'play'}
              disabled={!canToggle(selected) || pending}
              onClick={() => onToggle(selected, !selected.enabled)}
            >
              {selected.enabled ? 'Pause' : 'Resume'}
            </Button>
            <Link
              to="/pipelines/agents"
              search={{ view: 'policies', workflow: selected.display_id }}
              className="inline-flex h-7 items-center rounded-md border border-border bg-surface px-2.5 text-body text-fg hover:bg-surface-hover"
            >
              Edit policy
            </Link>
          </div>
        </div>

        <section className="border-b border-border px-4 py-3">
          <h3 className="m-0 mb-1 text-body font-semibold">Reads</h3>
          <ul className="m-0 list-none p-0 text-body">
            {selected.reads.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {selected.proposes ? (
            <>
              <h3 className="m-0 mb-1 mt-3 text-body font-semibold">
                Can propose
              </h3>
              <p className="m-0 text-body">{selected.proposes}</p>
            </>
          ) : null}
          <p className="m-0 mt-1 text-label text-fg-muted">
            Never signs, approves or deletes. People do.
          </p>
        </section>

        <section className="border-b border-border px-4 py-3">
          <h3 className="m-0 mb-1.5 text-body font-semibold">Recent runs</h3>
          {selectedRuns.length ? (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {selectedRuns.slice(0, 4).map((run) => {
                const proposal = proposalOf(run)
                const status = runStatus(run, proposal)
                return (
                  <li key={run.id} className="text-label">
                    <div className="flex items-center justify-between gap-2">
                      <Status tone={status.tone}>{status.label}</Status>
                      <span className="num text-fg-muted">
                        {shortStamp(run.started_at)}
                      </span>
                    </div>
                    <div className="ml-[15px] text-fg-muted">
                      {runLine(run, proposal, me, nameOf)}
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <Muted>No runs yet.</Muted>
          )}
        </section>

        <section className="px-4 py-3">
          <h3 className="m-0 mb-1.5 text-body font-semibold">Settings</h3>
          <DescriptionList
            labelWidth={84}
            items={[
              ['Owner', nameOf(selected.owner_user_id) ?? '—'],
              ['Policy', policySummary(selected.policy)],
              ['Projects', projectsOf(selected)],
              ['Starts on', selected.trigger_label],
              ['Model', selected.model_label ?? 'None, it follows fixed rules'],
            ]}
          />
        </section>
      </aside>
    </div>
  )
}
