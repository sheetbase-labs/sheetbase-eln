import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Muted, Section } from '#/components/ui/layout'
import { Select } from '#/components/ui/select'
import { Status } from '#/components/ui/status'
import { toast } from '#/components/ui/sonner'
import { ScheduleDialog } from '#/components/pipelines/schedule-dialog'
import { ScheduleHistoryDialog } from '#/components/pipelines/schedule-history'
import {
  WebhookCard,
  webhookKey,
  webhookRequest,
} from '#/components/pipelines/triggers-outputs'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import type { declaredRunInputs } from '#/components/pipelines/pipelines-data'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'
import { updatePipelineSchedule } from '#/lib/pipelines/data'
import { notebookDataClient } from '#/lib/notebook-data'
import { WINDOW_DAYS } from '#/lib/pipelines/start-rules'
import type { StartRules } from '#/lib/pipelines/start-rules'
import { startKind } from '#/lib/pipelines/starts-view'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

import { readbackLines } from './starts-readback'
import type { StartWay } from './starts-readback'
import { useDatasetNameMap, useSetStartRules } from './starts-data'

const DEFAULT_WINDOW = {
  days: 'weekdays',
  from: '07:00',
  to: '19:00',
  timeZone: 'Europe/London',
} as const

function numberOrNull(raw: string): number | null {
  const value = Number(raw)

  return raw.trim() !== '' && Number.isInteger(value) ? value : null
}

interface RuleProblems {
  window?: string
  rows?: string
  wait?: string
}

/** Problems a person can fix before saving; the database checks the same. */
export function ruleProblems(
  rules: StartRules,
  rowsText: string,
  waitText: string,
): RuleProblems {
  const problems: RuleProblems = {}

  if (rules.window && rules.window.from >= rules.window.to)
    problems.window = t('features.pipelineStarts.composer.invalidWindow')

  if (rules.minNewRows !== null) {
    const rows = numberOrNull(rowsText)

    if (rows === null || rows < 1 || rows > 1_000_000)
      problems.rows = t('features.pipelineStarts.composer.invalidRows')
  }

  const wait = numberOrNull(waitText)

  if (wait === null || wait < 0 || wait > 1440)
    problems.wait = t('features.pipelineStarts.composer.invalidWait')

  return problems
}

function StartRow({
  schedule,
  datasetNames,
  onEdit,
  onHistory,
  onToggle,
  busy,
}: {
  schedule: PipelineScheduleWire
  datasetNames: Map<string, string>
  onEdit: () => void
  onHistory: () => void
  onToggle: () => void
  busy: boolean
}) {
  const kind = startKind(schedule)

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-2 last:border-b-0">
      <span className="shrink-0 text-caption font-medium text-fg-muted md:w-24">
        {t(`features.pipelineStarts.composer.${kind}`)}
      </span>
      <span className="min-w-0 basis-full text-body md:basis-0 md:flex-1">
        {scheduleSpecLabel(schedule.kind, schedule.spec, datasetNames)}
      </span>
      {schedule.enabled ? null : (
        <Status tone="stored">
          {t('features.pipelineStarts.composer.paused')}
        </Status>
      )}
      <span className="flex gap-1.5">
        <Button size="sm" onClick={onHistory}>
          {t('features.pipelineStarts.composer.history')}
        </Button>
        <Button size="sm" onClick={onEdit}>
          {t('features.pipelineStarts.composer.edit')}
        </Button>
        <Button size="sm" disabled={busy} onClick={onToggle}>
          {schedule.enabled
            ? t('features.pipelineStarts.composer.pause')
            : t('features.pipelineStarts.composer.resume')}
        </Button>
      </span>
    </li>
  )
}

function WebhookRow({ definitionId }: { definitionId: string }) {
  const [open, setOpen] = useState(false)

  const state = useQuery({
    queryKey: webhookKey(definitionId),
    queryFn: () => webhookRequest(definitionId, 'GET'),
    staleTime: 30_000,
    retry: false,
  })

  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="shrink-0 text-caption font-medium text-fg-muted md:w-24">
          {t('features.pipelineStarts.composer.webhook')}
        </span>
        <span className="min-w-0 basis-full text-body md:basis-0 md:flex-1">
          {t('features.pipelineStarts.composer.webhookHint')}
        </span>
        <Status tone={state.data?.enabled ? 'ok' : 'stored'}>
          {state.data?.enabled
            ? t('features.pipelineStarts.composer.webhookOn')
            : t('features.pipelineStarts.composer.webhookOff')}
        </Status>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          {t('features.pipelineStarts.composer.edit')}
        </Button>
      </div>
      {open ? (
        <div className="mt-2">
          <WebhookCard definitionId={definitionId} />
        </div>
      ) : null}
    </li>
  )
}

/** The way a stored start is heard: a webhook counts when it is on. */
export function startWays(
  schedules: readonly PipelineScheduleWire[],
  webhookOn: boolean,
): StartWay[] {
  const ways = schedules.flatMap((s): StartWay[] =>
    s.enabled ? [startKind(s)] : [],
  )

  if (webhookOn) ways.push('webhook')

  return ways
}

export function StartsComposer({
  pipelineId,
  workspaceId,
  schedules,
  rules,
  declared,
  onTest,
}: {
  pipelineId: string
  workspaceId: string
  schedules: PipelineScheduleWire[]
  rules: StartRules
  declared: ReturnType<typeof declaredRunInputs>
  onTest: (draft: StartRules) => void
}) {
  const queryClient = useQueryClient()
  const save = useSetStartRules(workspaceId, pipelineId)
  const [draft, setDraft] = useState<StartRules>(rules)
  const [rowsText, setRowsText] = useState(String(rules.minNewRows ?? 1))
  const [waitText, setWaitText] = useState(String(rules.waitMinutes))
  const [editing, setEditing] = useState<PipelineScheduleWire | null>(null)
  const [adding, setAdding] = useState(false)
  const [history, setHistory] = useState<PipelineScheduleWire | null>(null)
  const datasetNames = useDatasetNameMap()

  const webhook = useQuery({
    queryKey: webhookKey(pipelineId),
    queryFn: () => webhookRequest(pipelineId, 'GET'),
    staleTime: 30_000,
    retry: false,
  })

  const toggle = useMutation({
    mutationFn: (input: { scheduleId: string; enabled: boolean }) =>
      updatePipelineSchedule(notebookDataClient, {
        workspaceId,
        scheduleId: input.scheduleId,
        enabled: input.enabled,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.schedules(pipelineId),
      }),
    onError: (error) =>
      toast(t('features.pipelineStarts.composer.saveFailed'), {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  // The typed numbers are what is saved; the draft only carries them once valid.
  const rowsValue = numberOrNull(rowsText)
  const waitValue = numberOrNull(waitText)

  const effective: StartRules = {
    ...draft,
    minNewRows:
      draft.minNewRows === null ? null : (rowsValue ?? draft.minNewRows),
    waitMinutes: waitValue ?? draft.waitMinutes,
  }

  const problems = ruleProblems(effective, rowsText, waitText)
  const hasProblem = Object.values(problems).some(Boolean)
  const dirty = JSON.stringify(effective) !== JSON.stringify(rules)
  const ways = startWays(schedules, webhook.data?.enabled ?? false)

  const onSave = () =>
    save.mutate(effective, {
      onSuccess: () => toast(t('features.pipelineStarts.composer.saved')),
      onError: (error) =>
        toast(t('features.pipelineStarts.composer.saveFailed'), {
          description: error instanceof Error ? error.message : undefined,
        }),
    })

  const reset = () => {
    setDraft(rules)
    setRowsText(String(rules.minNewRows ?? 1))
    setWaitText(String(rules.waitMinutes))
  }

  const bothConditions = draft.window !== null && draft.minNewRows !== null

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={t('features.pipelineStarts.composer.title')}
        action={
          <Button icon="plus" onClick={() => setAdding(true)}>
            {t('features.pipelineStarts.composer.addStart')}
          </Button>
        }
      >
        <Muted>{t('features.pipelineStarts.composer.intro')}</Muted>
        <div>
          <h3 className="mb-1 text-label font-medium text-fg">
            {t('features.pipelineStarts.composer.startsOn')}
          </h3>
          <ul className="m-0 list-none rounded-md border border-line bg-surface px-3 p-0">
            {schedules.map((schedule) => (
              <StartRow
                key={schedule.id}
                schedule={schedule}
                datasetNames={datasetNames}
                busy={toggle.isPending}
                onEdit={() => setEditing(schedule)}
                onHistory={() => setHistory(schedule)}
                onToggle={() =>
                  toggle.mutate({
                    scheduleId: schedule.id,
                    enabled: !schedule.enabled,
                  })
                }
              />
            ))}
            <WebhookRow definitionId={pipelineId} />
          </ul>
          {schedules.length === 0 && !webhook.data?.enabled ? (
            <Muted className="mt-1">
              {t('features.pipelineStarts.composer.noStarts')}
            </Muted>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-label font-medium text-fg">
              {t('features.pipelineStarts.composer.onlyIf')}
            </h3>
            {bothConditions ? (
              <Select
                size="sm"
                aria-label={t('features.pipelineStarts.composer.matchPrefix')}
                value={draft.conditionsMatch}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    conditionsMatch:
                      event.target.value === 'any' ? 'any' : 'all',
                  })
                }
              >
                <option value="all">
                  {t('features.pipelineStarts.composer.matchAll')}
                </option>
                <option value="any">
                  {t('features.pipelineStarts.composer.matchAny')}
                </option>
              </Select>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={draft.window !== null}
                onCheckedChange={(checked) =>
                  setDraft({
                    ...draft,
                    window: checked ? { ...DEFAULT_WINDOW } : null,
                  })
                }
              />
              {t('features.pipelineStarts.composer.window')}
            </label>
            {draft.window ? (
              <div className="ml-6 flex flex-wrap items-end gap-2">
                <Select
                  aria-label={t(
                    'features.pipelineStarts.composer.windowDaysLabel',
                  )}
                  value={draft.window.days}
                  onChange={(event) => {
                    const days = WINDOW_DAYS.find(
                      (d) => d === event.target.value,
                    )

                    if (days && draft.window)
                      setDraft({ ...draft, window: { ...draft.window, days } })
                  }}
                >
                  {WINDOW_DAYS.map((days) => (
                    <option key={days} value={days}>
                      {t(`features.pipelineStarts.composer.windowDays.${days}`)}
                    </option>
                  ))}
                </Select>
                <label className="flex flex-col gap-1 text-label">
                  <span className="text-fg-muted">
                    {t('features.pipelineStarts.composer.windowFrom')}
                  </span>
                  <Input
                    type="time"
                    className="w-28"
                    value={draft.window.from}
                    aria-invalid={Boolean(problems.window)}
                    onChange={(event) =>
                      draft.window &&
                      setDraft({
                        ...draft,
                        window: { ...draft.window, from: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-label">
                  <span className="text-fg-muted">
                    {t('features.pipelineStarts.composer.windowTo')}
                  </span>
                  <Input
                    type="time"
                    className="w-28"
                    value={draft.window.to}
                    aria-invalid={Boolean(problems.window)}
                    onChange={(event) =>
                      draft.window &&
                      setDraft({
                        ...draft,
                        window: { ...draft.window, to: event.target.value },
                      })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-label">
                  <span className="text-fg-muted">
                    {t('features.pipelineStarts.composer.windowZone')}
                  </span>
                  <Input
                    className="w-44"
                    value={draft.window.timeZone}
                    onChange={(event) =>
                      draft.window &&
                      setDraft({
                        ...draft,
                        window: {
                          ...draft.window,
                          timeZone: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                {problems.window ? (
                  <span className="text-label text-danger-text">
                    {problems.window}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-body">
              <Checkbox
                checked={draft.minNewRows !== null}
                onCheckedChange={(checked) =>
                  setDraft({
                    ...draft,
                    minNewRows: checked ? (rowsValue ?? 1) : null,
                  })
                }
              />
              {t('features.pipelineStarts.composer.minRows')}
            </label>
            {draft.minNewRows !== null ? (
              <div className="ml-6 flex flex-col gap-1">
                <Input
                  inputMode="numeric"
                  className="w-28"
                  aria-label={t('features.pipelineStarts.composer.minRows')}
                  aria-invalid={Boolean(problems.rows)}
                  value={rowsText}
                  onChange={(event) => setRowsText(event.target.value)}
                />
                <span
                  className={
                    problems.rows
                      ? 'text-label text-danger-text'
                      : 'text-label text-fg-muted'
                  }
                >
                  {problems.rows ??
                    t('features.pipelineStarts.composer.minRowsHint')}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
          <h3 className="text-label font-medium text-fg">
            {t('features.pipelineStarts.composer.thenDo')}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-body">
            <span>{t('features.pipelineStarts.composer.wait')}</span>
            <Input
              inputMode="numeric"
              className="w-20"
              aria-label={t('features.pipelineStarts.composer.wait')}
              aria-invalid={Boolean(problems.wait)}
              value={waitText}
              onChange={(event) => setWaitText(event.target.value)}
            />
            <span className="text-fg-muted">
              {t('features.pipelineStarts.composer.waitUnit')}
            </span>
          </div>
          <span
            className={
              problems.wait
                ? 'text-label text-danger-text'
                : 'text-label text-fg-muted'
            }
          >
            {problems.wait ?? t('features.pipelineStarts.composer.waitHint')}
          </span>
          <div className="flex flex-wrap items-center gap-2 text-body">
            <span className="w-56 max-w-full">
              {t('features.pipelineStarts.composer.whileRunning')}
            </span>
            <Select
              aria-label={t('features.pipelineStarts.composer.whileRunning')}
              value="skip"
              disabled
            >
              <option value="skip">
                {t('features.pipelineStarts.composer.whileRunningSkip')}
              </option>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-body">
            <span className="w-56 max-w-full">
              {t('features.pipelineStarts.composer.missed')}
            </span>
            <Select
              aria-label={t('features.pipelineStarts.composer.missed')}
              value={draft.missedRuns}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  missedRuns:
                    event.target.value === 'skip' ? 'skip' : 'run_once',
                })
              }
            >
              <option value="run_once">
                {t('features.pipelineStarts.composer.missedOnce')}
              </option>
              <option value="skip">
                {t('features.pipelineStarts.composer.missedSkip')}
              </option>
            </Select>
          </div>
        </div>

        <div
          aria-label={t('features.pipelineStarts.readback.title')}
          className="rounded-md bg-surface-muted px-3 py-2.5 text-body"
        >
          <h3 className="mb-1 text-label font-medium text-fg-muted">
            {t('features.pipelineStarts.readback.title')}
          </h3>
          <p className="m-0">{readbackLines(ways, effective).join(' ')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!dirty || hasProblem || save.isPending}
            onClick={onSave}
          >
            {save.isPending
              ? t('features.pipelineStarts.composer.saving')
              : t('features.pipelineStarts.composer.save')}
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={reset}>
            {t('features.pipelineStarts.composer.reset')}
          </Button>
          <Button disabled={hasProblem} onClick={() => onTest(effective)}>
            {t('features.pipelineStarts.composer.test')}
          </Button>
          {dirty ? (
            <Muted>{t('features.pipelineStarts.composer.unsaved')}</Muted>
          ) : null}
        </div>
      </Section>

      <ScheduleDialog
        open={adding}
        onOpenChange={setAdding}
        definitionId={pipelineId}
        workspaceId={workspaceId}
        inputs={declared.inputs}
        parameters={declared.parameters}
      />
      {editing ? (
        <ScheduleDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          schedule={editing}
          definitionId={pipelineId}
          workspaceId={workspaceId}
          inputs={declared.inputs}
          parameters={declared.parameters}
        />
      ) : null}
      {history ? (
        <ScheduleHistoryDialog
          open
          onOpenChange={(open) => {
            if (!open) setHistory(null)
          }}
          schedule={history}
          title={scheduleSpecLabel(history.kind, history.spec, datasetNames)}
        />
      ) : null}
    </div>
  )
}
