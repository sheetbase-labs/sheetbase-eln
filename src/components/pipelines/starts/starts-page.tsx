import { useState } from 'react'

import { t } from '#/copy'
import { BoardButton, BoardScope } from '#/features/pipelines/board/board'
import {
  currentVersion,
  declaredRunInputs,
  useDefinitionRuns,
  usePipelineDefinition,
  usePipelineVersions,
  useRunNumbers,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { now as appNow } from '#/lib/clock'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import type { StartRules } from '#/lib/pipelines/start-rules'
import type {
  PipelineDefinitionVersionWire,
  PipelineRunWire,
  PipelineScheduleActivityWire,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'

import { useRuleForm, startWays } from './composer-model'
import { HeardEvents } from './heard-events'
import { NextStarts } from './next-starts'
import { RichLine } from './rich-line'
import { RunTimeline, TimelineLegend } from './run-timeline'
import { SelectedRun } from './selected-run'
import { StartsAside } from './starts-aside'
import { StartsComposer } from './starts-composer'
import {
  useDatasetNameMap,
  useDefinitionActivity,
  useWebhookOn,
} from './starts-data'
import { readbackLines } from './starts-readback'
import { TestStartsDialog } from './test-starts-dialog'
import './starts-board.css'

/** The last seven days of runs and skipped starts, and the run picked from them. */
function weekOf(input: {
  runs: PipelineRunWire[]
  log: PipelineScheduleActivityWire[]
  list: PipelineDefinitionVersionWire[]
  now: Date
  picked: string | null
}) {
  const week = input.now.getTime() - 7 * 86_400_000

  const weekRuns = input.runs.filter((run) => {
    const at = Date.parse(run.started_at)

    return at >= week && at <= input.now.getTime()
  })

  const skips = input.log
    .filter((row) => row.kind.startsWith('skipped_'))
    .map((row) => ({ id: row.id, at: row.occurred_at }))

  const versionOf = (run: { definition_version_id: string }) => {
    const found = input.list.find((v) => v.id === run.definition_version_id)

    return found ? `v${found.version}` : '—'
  }

  const heardFor = (runId: string) =>
    input.log.find((row) => row.run_id === runId && row.kind === 'started')
      ?.label ?? null

  return {
    weekRuns,
    skips,
    selected: weekRuns.find((run) => run.id === input.picked) ?? null,
    versionOf,
    heardFor,
  }
}

/** The loaded Starts and runs tab: how a run begins, what has to be true
 * first, what the starts heard and did, and the week of runs that followed. */
export function StartsPage({
  pipelineId,
  workspaceId,
  schedules,
  rules,
}: {
  pipelineId: string
  workspaceId: string
  schedules: PipelineScheduleWire[]
  rules: StartRules
}) {
  const timeZone = useDisplayTimeZone()
  const definition = usePipelineDefinition(pipelineId)
  const members = useWorkspaceMemberNames()
  const activity = useDefinitionActivity(pipelineId)
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const runs = useDefinitionRuns(list)
  const numbers = useRunNumbers(list)
  const datasetNames = useDatasetNameMap()
  const webhookOn = useWebhookOn(pipelineId)
  const form = useRuleForm(rules)
  const [testing, setTesting] = useState<StartRules | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const now = appNow()

  const published = currentVersion(list)

  const declared = published
    ? declaredRunInputs(published)
    : { inputs: [], parameters: [] }

  const shownRules = form.effective
  const ways = startWays(schedules, webhookOn)
  const lines = readbackLines(ways, shownRules)
  const log = activity.data ?? []

  const { weekRuns, skips, selected, versionOf, heardFor } = weekOf({
    runs: runs.data ?? [],
    log,
    list,
    now,
    picked,
  })

  const skippedCount = skips.length

  const startsOn = schedules
    .filter((s) => s.enabled)
    .map((s) => scheduleSpecLabel(s.kind, s.spec, datasetNames))
    .filter((label) => label !== '—')

  if (webhookOn) startsOn.push(t('features.pipelineStarts.composer.webhook'))

  const subtitle = published
    ? t('features.pipelineStarts.tab.subtitle', {
        version: published.version,
        list: startsOn.join(', ') || t('features.pipelineStarts.tab.noStarts'),
      })
    : t('features.pipelineStarts.tab.subtitleDraftOnly')

  const owner = definition.data?.created_by_user_id
    ? (members.data?.[definition.data.created_by_user_id] ?? null)
    : null

  return (
    <BoardScope className="starts-root flex min-h-0 min-w-0 flex-1">
      <div className="starts-main">
        <section>
          <div className="sec-h">
            <h2 className="sh">{t('features.pipelineStarts.tab.heading')}</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              {subtitle}
            </span>
            <span style={{ flexGrow: 1 }} />
            <BoardButton
              variant="quiet"
              size="sm"
              icon="play"
              disabled={form.hasProblem}
              onClick={() => setTesting(shownRules)}
            >
              {t('features.pipelineStarts.tab.test')}
            </BoardButton>
          </div>

          <div className="starts-grid">
            <StartsComposer
              pipelineId={pipelineId}
              workspaceId={workspaceId}
              schedules={schedules}
              declared={declared}
              form={form}
            />
            <div className="starts-side">
              <section>
                <h3 className="h3plain">
                  {t('features.pipelineStarts.readback.title')}
                </h3>
                <div className="notice info rb">
                  {lines.map((line, index) => (
                    <span key={line}>
                      {index > 0 ? ' ' : null}
                      <RichLine text={line} />
                    </span>
                  ))}
                </div>
              </section>
              <NextStarts
                schedules={schedules}
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
        </section>

        <div className="starts-runs">
          <section style={{ minWidth: 0 }}>
            <div className="sec-h">
              <h2 className="sh">{t('features.pipelineStarts.runs.title')}</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                {t('features.pipelineStarts.runs.summary', {
                  runs: weekRuns.length,
                  skipped: skippedCount,
                })}
              </span>
              <span style={{ flexGrow: 1 }} />
              <TimelineLegend hasWindow={shownRules.window !== null} />
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
          </section>
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
            <div className="muted" style={{ fontSize: 12 }}>
              {t('features.pipelineStarts.runs.pick')}
            </div>
          ) : null}
        </div>
      </div>
      <StartsAside
        workspaceId={workspaceId}
        displayId={definition.data?.display_id ?? ''}
        owner={owner}
      />
      {testing ? (
        <TestStartsDialog
          rules={testing}
          schedules={schedules}
          workspaceId={workspaceId}
          pipelineId={pipelineId}
          now={now}
          onClose={() => setTesting(null)}
        />
      ) : null}
    </BoardScope>
  )
}
