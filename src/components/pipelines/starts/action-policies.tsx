import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
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

/** The agent actions that touch pipelines; their levels are the ones the
 * Agents page keeps, so changing one here changes it there. */
const PIPELINE_ACTIONS = AGENT_ACTIONS.filter(
  (action) => /pipeline/.test(action.key) || action.area === 'Pipelines',
)

/** What the pipeline runs as, and how far an agent may go with it on its own. */
export function ActionPolicies({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()

  const policies = useQuery({
    queryKey: agentActionKeys.policies,
    queryFn: () => fetchAgentActionPolicies(notebookDataClient),
  })

  const save = useMutation({
    mutationFn: (input: {
      actionKey: string
      level: AgentActionLevel | 'default'
    }) => setAgentActionPolicy(notebookDataClient, { workspaceId, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentActionKeys.policies })
      toast(t('features.pipelineStarts.policies.saved'))
    },
    onError: () => toast(t('features.pipelineStarts.policies.saveFailed')),
  })

  const rows = policies.data ?? []

  return (
    <Section
      title={t('features.pipelineStarts.policies.title')}
      action={
        <Link
          to="/pipelines/agents"
          className="text-caption text-accent hover:underline"
        >
          {t('features.pipelineStarts.policies.manage')}
        </Link>
      }
    >
      <Muted>{t('features.pipelineStarts.policies.intro')}</Muted>
      <div className="rounded-md border border-line bg-surface px-3 py-2">
        <h3 className="text-label font-medium text-fg">
          {t('features.pipelineStarts.policies.runsAs')}
        </h3>
        <Muted>{t('features.pipelineStarts.policies.runsAsBody')}</Muted>
      </div>
      {PIPELINE_ACTIONS.length === 0 ? (
        <Muted>{t('features.pipelineStarts.policies.none')}</Muted>
      ) : (
        <ul className="m-0 list-none rounded-md border border-line bg-surface px-3 p-0">
          {PIPELINE_ACTIONS.map((action) => {
            const level = resolveAgentActionLevel(rows, action.key)

            return (
              <li
                key={action.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{action.label}</span>
                  <span className="block text-caption text-fg-muted">
                    {action.description}
                  </span>
                </span>
                <Select
                  size="sm"
                  aria-label={`${t('features.pipelineStarts.policies.level')}: ${action.label}`}
                  value={level}
                  disabled={save.isPending}
                  onChange={(event) => {
                    const next = agentActionLevelsFor(action.key).find(
                      (l) => l === event.target.value,
                    )

                    if (next)
                      save.mutate({ actionKey: action.key, level: next })
                  }}
                >
                  {agentActionLevelsFor(action.key).map((l) => (
                    <option key={l} value={l}>
                      {t(`features.pipelineStarts.policies.levels.${l}`)}
                    </option>
                  ))}
                </Select>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
