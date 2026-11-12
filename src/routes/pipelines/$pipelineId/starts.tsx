import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { t } from '#/copy'
import { ProjectListFailure } from '#/components/projects/project-list'
import { Muted } from '#/components/ui/layout'
import {
  currentVersion,
  declaredRunInputs,
  useDefinitionRuns,
  usePipelineVersions,
  useRunNumbers,
  useSchedules,
} from '#/components/pipelines/pipelines-data'
import { ActionPolicies } from '#/components/pipelines/starts/action-policies'
import { HeardEvents } from '#/components/pipelines/starts/heard-events'
import { NextStarts } from '#/components/pipelines/starts/next-starts'
import { RunTimeline } from '#/components/pipelines/starts/run-timeline'
import { StartsComposer } from '#/components/pipelines/starts/starts-composer'
import {
  useDefinitionActivity,
  useStartRules,
} from '#/components/pipelines/starts/starts-data'
import { TestStartsDialog } from '#/components/pipelines/starts/test-starts-dialog'
import { now as appNow } from '#/lib/clock'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import type { StartRules } from '#/lib/pipelines/start-rules'

/** The Starts and runs tab: how a run begins, what has to be true first, what
 * the starts heard and did, and the week of runs that followed. */
export const Route = createFileRoute('/pipelines/$pipelineId/starts')({
  component: PipelineStarts,
})

function PipelineStarts() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const timeZone = useDisplayTimeZone()
  const schedules = useSchedules(pipelineId)
  const rules = useStartRules(pipelineId)
  const activity = useDefinitionActivity(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const runs = useDefinitionRuns(list)
  const numbers = useRunNumbers(list)
  const [testing, setTesting] = useState<StartRules | null>(null)
  const now = appNow()
  const week = now.getTime() - 7 * 86_400_000

  const declared = (() => {
    const version = currentVersion(list)

    return version ? declaredRunInputs(version) : { inputs: [], parameters: [] }
  })()

  const failed = schedules.isError ? schedules : rules.isError ? rules : null

  if (failed) {
    return (
      <div className="px-4 py-4 md:px-6">
        <ProjectListFailure
          error={failed.error}
          what={t('features.pipelineStarts.tab.failure')}
          onRetry={() => void failed.refetch()}
        />
      </div>
    )
  }

  if (!schedules.data || !rules.data) {
    return (
      <div className="px-4 py-4 md:px-6">
        <Muted>{t('features.pipelineStarts.tab.loading')}</Muted>
      </div>
    )
  }

  const weekRuns = (runs.data ?? []).filter(
    (run) =>
      Date.parse(run.started_at) >= week &&
      Date.parse(run.started_at) <= now.getTime(),
  )

  const log = activity.data ?? []

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-6">
          <StartsComposer
            // A saved change resets the form to what the database holds.
            key={JSON.stringify(rules.data)}
            pipelineId={pipelineId}
            workspaceId={workspaceId}
            schedules={schedules.data}
            rules={rules.data}
            declared={declared}
            onTest={setTesting}
          />
          <HeardEvents
            rows={log}
            pipelineId={pipelineId}
            numbers={numbers.data}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <NextStarts schedules={schedules.data} rules={rules.data} now={now} />
          <RunTimeline
            runs={weekRuns}
            activity={log.map((a) => ({
              id: a.id,
              at: a.occurred_at,
              kind: a.kind,
            }))}
            numbers={numbers.data}
            now={now}
            timeZone={timeZone}
            pipelineId={pipelineId}
            workspaceId={workspaceId}
          />
        </div>
      </div>
      <div className="mt-6">
        <ActionPolicies workspaceId={workspaceId} />
      </div>
      {testing ? (
        <TestStartsDialog
          rules={testing}
          schedules={schedules.data}
          workspaceId={workspaceId}
          pipelineId={pipelineId}
          now={now}
          onClose={() => setTesting(null)}
        />
      ) : null}
    </div>
  )
}
