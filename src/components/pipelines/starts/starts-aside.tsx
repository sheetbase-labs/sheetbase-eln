import { Fragment } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { Avatar } from '#/components/ui/avatar'
import { BoardSegmented } from '#/features/pipelines/board/board'
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

import './starts-board.css'

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
    <aside
      className="pb-insp"
      aria-label={t('features.pipelineStarts.aside.label')}
    >
      <section>
        <h3>{t('features.pipelineStarts.aside.runsAs')}</h3>
        <div className="who">
          <Avatar initials="PL" size="sm" />
          <div>
            <div style={{ fontWeight: 600 }}>
              {t('features.pipelineStarts.aside.identity', { id: displayId })}
            </div>
            <div className="muted">
              {owner
                ? `${t('features.pipelineStarts.aside.identityBody')} · ${owner}`
                : t('features.pipelineStarts.aside.identityBody')}
            </div>
          </div>
        </div>
        <div className="note">
          {t('features.pipelineStarts.aside.runsAsBody')}
        </div>
      </section>

      <section>
        <h3>{t('features.pipelineStarts.aside.policies')}</h3>
        {POLICY_ACTIONS.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {t('features.pipelineStarts.aside.noPolicies')}
          </div>
        ) : (
          <div className="pol">
            {POLICY_ACTIONS.map((action) => (
              <Fragment key={action.key}>
                <span>{action.label}</span>
                <BoardSegmented
                  label={t('features.pipelineStarts.aside.levelFor', {
                    action: action.label,
                  })}
                  value={resolveAgentActionLevel(rows, action.key)}
                  options={agentActionLevelsFor(action.key).map((level) => ({
                    value: level,
                    label: t(`features.pipelineStarts.aside.levels.${level}`),
                  }))}
                  onChange={(value) => {
                    const level = agentActionLevelsFor(action.key).find(
                      (candidate) => candidate === value,
                    )

                    if (level && !save.isPending)
                      save.mutate({ actionKey: action.key, level })
                  }}
                />
              </Fragment>
            ))}
          </div>
        )}
        <div className="note">
          {t('features.pipelineStarts.aside.policiesHint')}
        </div>
      </section>

      <section>
        <h3>{t('features.pipelineStarts.aside.alwaysNever')}</h3>
        <div className="nv">
          {ALWAYS_NEVER.map((key) => (
            <span key={key}>
              <Icon name="lock" size={12} />
              {t(`features.pipelineStarts.aside.never.${key}`)}
            </span>
          ))}
        </div>
        <div className="note">
          {t('features.pipelineStarts.aside.neverBody')}
        </div>
      </section>
    </aside>
  )
}
