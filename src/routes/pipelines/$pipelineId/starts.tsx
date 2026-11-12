import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { ProjectListFailure } from '#/components/projects/project-list'
import { Button } from '#/components/ui/button'
import { Muted } from '#/components/ui/layout'
import {
  currentVersion,
  declaredRunInputs,
  useDefinitionRuns,
  usePipelineDefinition,
  usePipelineVersions,
  useRunNumbers,
  useSchedules,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { HeardEvents } from '#/components/pipelines/starts/heard-events'
import { NextStarts } from '#/components/pipelines/starts/next-starts'
import { RichLine } from '#/components/pipelines/starts/rich-line'
import {
  RunTimeline,
  TimelineLegend,
} from '#/components/pipelines/starts/run-timeline'
import { SelectedRun } from '#/components/pipelines/starts/selected-run'
import { StartsAside } from '#/components/pipelines/starts/starts-aside'
import { startWays } from '#/components/pipelines/starts/composer-model'
import { StartsComposer } from '#/components/pipelines/starts/starts-composer'
import {
  useDatasetNameMap,
  useDefinitionActivity,
  useStartRules,
  useWebhookOn,
} from '#/components/pipelines/starts/starts-data'
import { readbackLines } from '#/components/pipelines/starts/starts-readback'
import { TestStartsDialog } from '#/components/pipelines/starts/test-starts-dialog'
import { now as appNow } from '#/lib/clock'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import type { StartRules } from '#/lib/pipelines/start-rules'
import { scheduleSpecLabel } from '../-schedule-labels'

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
  const definition = usePipelineDefinition(pipelineId)
  const members = useWorkspaceMemberNames()
  const schedules = useSchedules(pipelineId)
  const rules = useStartRules(pipelineId)
  const activity = useDefinitionActivity(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const runs = useDefinitionRuns(list)
  const numbers = useRunNumbers(list)
  const datasetNames = useDatasetNameMap()
  const webhookOn = useWebhookOn(pipelineId)
  const [draft, setDraft] = useState<StartRules | null>(null)
  const [problem, setProblem] = useState(false)
  const [testing, setTesting] = useState<StartRules | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const now = appNow()
  const week = now.getTime() - 7 * 86_400_000

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

  const published = currentVersion(list)

  const declared = published
    ? declaredRunInputs(published)
    : { inputs: [], parameters: [] }

  const shownRules = draft ?? rules.data
  const ways = startWays(schedules.data, webhookOn)
  const lines = readbackLines(ways, shownRules)
  const log = activity.data ?? []

  const weekRuns = (runs.data ?? []).filter((run) => {
    const at = Date.parse(run.started_at)

    return at >= week && at <= now.getTime()
  })

  const skips = log
    .filter((row) => row.kind.startsWith('skipped_'))
    .map((row) => ({ id: row.id, at: row.occurred_at }))

  const skippedCount = skips.length
  const selected = weekRuns.find((run) => run.id === picked) ?? null

  const versionOf = (run: { definition_version_id: string }) => {
    const found = list.find((v) => v.id === run.definition_version_id)

    return found ? `v${found.version}` : '—'
  }

  const heardFor = (runId: string) =>
    log.find((row) => row.run_id === runId && row.kind === 'started')?.label ??
    null

  const startsOn = schedules.data
    .filter((s) => s.enabled)
    .map((s) => scheduleSpecLabel(s.kind, s.spec, datasetNames))
    .filter((label) => label !== '—')

  if (webhookOn) startsOn.push(t('features.pipelineStarts.composer.webhook'))

  const owner = definition.data?.created_by_user_id
    ? (members.data?.[definition.data.created_by_user_id] ?? null)
    : null

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-section">
            {t('features.pipelineStarts.tab.heading')}
          </h2>
          <span className="text-caption text-fg-muted">
            {published
              ? t('features.pipelineStarts.tab.subtitle', {
                  version: published.version,
                  list:
                    startsOn.length > 0
                      ? startsOn.join(', ')
                      : t('features.pipelineStarts.tab.noStarts'),
                })
              : t('features.pipelineStarts.tab.subtitleDraftOnly')}
          </span>
          <Button
            className="ml-auto"
            icon="play"
            variant="quiet"
            disabled={problem}
            onClick={() => setTesting(shownRules)}
          >
            {t('features.pipelineStarts.tab.test')}
          </Button>
        </div>

        <div className="mt-3 grid gap-x-5 gap-y-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
          <StartsComposer
            // A saved change resets the form to what the database holds.
            key={JSON.stringify(rules.data)}
            pipelineId={pipelineId}
            workspaceId={workspaceId}
            schedules={schedules.data}
            rules={rules.data}
            declared={declared}
            onDraft={(next, _dirty, invalid) => {
              setDraft(next)
              setProblem(invalid)
            }}
          />
          <div className="flex min-w-0 flex-col gap-4">
            <section className="flex flex-col gap-1.5">
              <h3 className="text-label font-semibold">
                {t('features.pipelineStarts.readback.title')}
              </h3>
              <p className="m-0 rounded-md bg-surface-muted px-3.5 py-3 text-body leading-[21px]">
                {lines.map((line, index) => (
                  <span key={line}>
                    {index > 0 ? ' ' : null}
                    <RichLine text={line} />
                  </span>
                ))}
              </p>
            </section>
            <NextStarts
              schedules={schedules.data}
              rules={shownRules}
              now={now}
              timeZone={timeZone}
              datasetNames={datasetNames}
            />
            <HeardEvents
              rows={log}
              pipelineId={pipelineId}
              numbers={numbers.data}
              now={now}
              timeZone={timeZone}
            />
          </div>
        </div>

        <section className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-section">
              {t('features.pipelineStarts.runs.title')}
            </h2>
            <span className="text-caption text-fg-muted">
              {t('features.pipelineStarts.runs.summary', {
                runs: weekRuns.length,
                skipped: skippedCount,
              })}
            </span>
            <div className="ml-auto">
              <TimelineLegend hasWindow={shownRules.window !== null} />
            </div>
          </div>
          <RunTimeline
            runs={weekRuns}
            skips={skips}
            numbers={numbers.data}
            now={now}
            timeZone={timeZone}
            window={shownRules.window}
            picked={picked}
            onPick={setPicked}
          />
          {selected ? (
            <SelectedRun
              run={selected}
              number={numbers.data?.get(selected.id)}
              version={versionOf(selected)}
              heard={heardFor(selected.id)}
              pipelineId={pipelineId}
              workspaceId={workspaceId}
            />
          ) : weekRuns.length > 0 ? (
            <Muted className="flex items-center gap-1.5">
              <Icon name="info" size={12} />
              {t('features.pipelineStarts.runs.pick')}
            </Muted>
          ) : null}
        </section>
      </div>
      <StartsAside
        workspaceId={workspaceId}
        displayId={definition.data?.display_id ?? ''}
        owner={owner}
      />
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
