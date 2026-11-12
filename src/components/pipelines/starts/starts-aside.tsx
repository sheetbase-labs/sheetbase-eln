import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Avatar } from '#/components/ui/avatar'
import { Inspector, Muted } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import {
  AGENT_ACTIONS,
  agentActionKeys,
  agentActionLevelsFor,
  fetchAgentActionPolicies,
  resolveAgentActionLevel,
  setAgentActionPolicy,
} from '#/lib/agent-action-policy'
import type { AgentActionLevel } from '#/lib/agent-action-policy'
import { notebookDataClient } from '#/lib/notebook-data'
import { PIPELINE_ACTIONS } from '#/lib/pipelines/actions'
import { cn } from '#/lib/utils'

const ALWAYS_NEVER = [
  'sign',
  'submit',
  'approve',
  'amend',
  'lock',
  'delete',
] as const

/** The agent actions a pipeline step can take, with the label a step shows. */
const POLICY_ACTIONS = PIPELINE_ACTIONS.flatMap((action) => {
  const entry = AGENT_ACTIONS.find(
    (candidate) =>
      candidate.key === action.operation || candidate.key === action.rpc,
  )

  return entry ? [{ key: entry.key, label: action.label }] : []
})

/** One setting as three joined buttons, the way the board draws it. */
function Segmented({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: AgentActionLevel
  options: readonly AgentActionLevel[]
  disabled: boolean
  onChange: (level: AgentActionLevel) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-md border border-border bg-surface-muted p-0.5"
    >
      {options.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          disabled={disabled}
          onClick={() => onChange(level)}
          className={cn(
            'h-5 cursor-pointer rounded-[4px] px-1.5 text-caption text-fg-muted focus-visible:outline-2 focus-visible:outline-focus',
            value === level &&
              'bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--border)]',
          )}
        >
          {t(`features.pipelineStarts.aside.levels.${level}`)}
        </button>
      ))}
    </div>
  )
}

/** The right-hand column of the tab: who the pipeline runs as, how far an
 * agent may go with its ELN actions, and what nothing may ever do. */
export function StartsAside({
  workspaceId,
  displayId,
  owner,
}: {
  workspaceId: string
  displayId: string
  owner: string | null
}) {
  const queryClient = useQueryClient()

  const policies = useQuery({
    queryKey: agentActionKeys.policies,
    queryFn: () => fetchAgentActionPolicies(notebookDataClient),
  })

  const save = useMutation({
    mutationFn: (input: { actionKey: string; level: AgentActionLevel }) =>
      setAgentActionPolicy(notebookDataClient, { workspaceId, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentActionKeys.policies })
      toast(t('features.pipelineStarts.aside.saved'))
    },
    onError: () => toast(t('features.pipelineStarts.aside.saveFailed')),
  })

  const rows = policies.data ?? []

  return (
    <Inspector
      label={t('features.pipelineStarts.aside.label')}
      className="gap-5"
    >
      <section className="flex flex-col gap-2">
        <h2 className="text-label font-semibold">
          {t('features.pipelineStarts.aside.runsAs')}
        </h2>
        <div className="flex items-start gap-2">
          <Avatar initials="PL" size="sm" />
          <div className="min-w-0 text-caption">
            <div className="text-body font-medium">
              {t('features.pipelineStarts.aside.identity', { id: displayId })}
            </div>
            <div className="text-fg-muted">
              {owner
                ? `${t('features.pipelineStarts.aside.identityBody')} · ${owner}`
                : t('features.pipelineStarts.aside.identityBody')}
            </div>
          </div>
        </div>
        <Muted>{t('features.pipelineStarts.aside.runsAsBody')}</Muted>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-label font-semibold">
          {t('features.pipelineStarts.aside.policies')}
        </h2>
        {POLICY_ACTIONS.length === 0 ? (
          <Muted>{t('features.pipelineStarts.aside.noPolicies')}</Muted>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {POLICY_ACTIONS.map((action) => (
              <li
                key={action.key}
                className="flex items-center justify-between gap-2 text-caption"
              >
                <span className="min-w-0">{action.label}</span>
                <Segmented
                  label={t('features.pipelineStarts.aside.levelFor', {
                    action: action.label,
                  })}
                  value={resolveAgentActionLevel(rows, action.key)}
                  options={agentActionLevelsFor(action.key)}
                  disabled={save.isPending}
                  onChange={(level) =>
                    save.mutate({ actionKey: action.key, level })
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <Muted>{t('features.pipelineStarts.aside.policiesHint')}</Muted>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-label font-semibold">
          {t('features.pipelineStarts.aside.alwaysNever')}
        </h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0 text-caption">
          {ALWAYS_NEVER.map((key) => (
            <li key={key} className="flex items-center gap-1.5">
              <Icon name="lock" size={12} className="text-fg-muted" />
              {t(`features.pipelineStarts.aside.never.${key}`)}
            </li>
          ))}
        </ul>
        <Muted>{t('features.pipelineStarts.aside.neverBody')}</Muted>
      </section>
    </Inspector>
  )
}
