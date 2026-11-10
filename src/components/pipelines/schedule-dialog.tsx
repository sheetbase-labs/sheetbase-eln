import { useMemo, useState } from 'react'
import { z } from 'zod'
import { clockOption } from '#/lib/display-clock'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { rich, t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Notice } from '#/components/ui/alert'
import { Select } from '#/components/ui/select'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import { toast } from '#/components/ui/sonner'
import {
  pipelineDataQueryKeys,
  useDatasetVersionChoices,
} from '#/components/pipelines/pipelines-data'
import {
  parameterError,
  parameterValue,
  parameterText,
} from '#/components/pipelines/run-parameters'
import { defaultTimeZone, knownTimeZones } from './schedule-form'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import { MISSED_RUN_GRACE_MINUTES, upcomingRuns } from '#/lib/pipeline-schedule'
import {
  REPEAT_LABELS,
  WEEKDAYS,
  draftError,
  draftToSchedule,
  emptyDraft,
  eventOptions,
  scheduleToDraft,
} from '#/lib/pipeline-schedule-form'
import type {
  InputDraft,
  InputMode,
  Repeat,
  ScheduleDraft,
} from '#/lib/pipeline-schedule-form'
import {
  createPipelineSchedule,
  updatePipelineSchedule,
} from '#/lib/pipelines/data'
import type { PipelineInput, PipelineParameter } from '#/lib/pipelines/config'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'
import { pipelineJsonObjectSchema } from '#/lib/pipelines/types'
import { dateTimeFormat } from '#/lib/intl-cache'

const REPEATS: Repeat[] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'interval',
  'cron',
  'event',
]

function useDatasetOptions(enabled: boolean, client: DataClient) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'trigger-dataset-options'],
    enabled,
    queryFn: async (): Promise<Array<{ id: string; label: string }>> => {
      const rows = await client.list<{
        id: string
        name: string
        display_id: string | null
      }>('datasets', '?select=id,name,display_id&order=name.asc')

      return rows.map((row) => ({
        id: row.id,
        label: row.display_id ? `${row.display_id} · ${row.name}` : row.name,
      }))
    },
    staleTime: 60_000,
  })
}

function useInstrumentOptions(enabled: boolean, client: DataClient) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'trigger-instruments'],
    enabled,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> =>
      client.list<{ id: string; name: string }>(
        'instruments',
        '?select=id,name&order=name.asc',
      ),
    staleTime: 60_000,
  })
}

const MODE_LABELS: Record<Exclude<InputMode, 'event'>, string> = {
  latest: t('data.scheduleDialog.latestVersionDataset'),
  incremental: t('data.scheduleDialog.onlyWhenDatasetHas'),
  pinned: t('data.scheduleDialog.oneFixedDatasetVersion'),
}

/**
 * Create or edit a trigger. Everything the database will check is checked
 * here first with the same rules, so a trigger that cannot work is refused
 * before the request leaves the page — and the form shows when the first runs
 * will be, on the trigger's own clock, so the schedule can be read back.
 */
interface ScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing this trigger; absent when adding one. */
  schedule?: PipelineScheduleWire
  definitionId: string
  workspaceId: string
  inputs: PipelineInput[]
  parameters: PipelineParameter[]
  client?: DataClient
}

export function ScheduleDialog({ open, ...props }: ScheduleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(600px,calc(100vw-32px))]">
        <ScheduleForm
          key={JSON.stringify([
            open,
            props.schedule,
            props.inputs,
            props.parameters,
          ])}
          open={open}
          {...props}
        />
      </DialogContent>
    </Dialog>
  )
}

function initialDraft({
  schedule,
  inputs,
  parameters,
}: Pick<
  ScheduleDialogProps,
  'schedule' | 'inputs' | 'parameters'
>): ScheduleDraft {
  const zone = defaultTimeZone()
  const inputNames = inputs.map((input) => input.name)

  if (schedule) return scheduleToDraft(schedule, inputNames, zone)
  const draft = emptyDraft(zone)

  // New triggers follow the latest data: pinning is the opt-in, not the
  // default, so a daily trigger does not read the same old version forever.
  for (const name of inputNames) {
    draft.inputs[name] = blankInput()
  }

  for (const p of parameters) {
    if (p.default !== undefined) draft.parameters[p.name] = parameterText(p)
  }

  return draft
}

function ScheduleForm({
  open,
  onOpenChange,
  schedule,
  definitionId,
  workspaceId,
  inputs,
  parameters,
  client = notebookDataClient,
}: ScheduleDialogProps) {
  const queryClient = useQueryClient()
  const inputNames = inputs.map((input) => input.name)

  const [draft, setDraft] = useState(() =>
    initialDraft({ schedule, inputs, parameters }),
  )

  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const timed = draft.repeat !== 'event'

  const datasets = useDatasetOptions(open, client)

  const instruments = useInstrumentOptions(
    open && draft.repeat === 'event' && draft.eventType === 'dataset.versioned',
    client,
  )

  const versionChoices = useDatasetVersionChoices(
    open && Object.values(draft.inputs).some((i) => i?.mode === 'pinned'),
    client,
  )

  // An event trigger binds the version that fired it to one input.
  const boundInput =
    draft.repeat === 'event' && draft.eventType === 'dataset.versioned'
      ? draft.inputName || inputNames[0]
      : undefined

  const modeFor = (name: string): InputMode =>
    name === boundInput
      ? 'event'
      : ((draft.inputs[name]?.mode === 'event'
          ? 'latest'
          : draft.inputs[name]?.mode) ?? 'latest')

  const effective: ScheduleDraft = {
    ...draft,
    inputs: Object.fromEntries(
      inputNames.map((name) => [
        name,
        { ...(draft.inputs[name] ?? blankInput()), mode: modeFor(name) },
      ]),
    ),
  }

  const rawValue = (p: PipelineParameter) =>
    draft.parameters[p.name] ?? parameterText(p)

  const parametersGiven = Object.fromEntries(
    parameters.flatMap((p) => {
      const value = parameterValue(p, rawValue(p))

      return value === undefined ? [] : [[p.name, value]]
    }),
  )

  const parameterProblem = parameters.some((p) =>
    parameterError(p, rawValue(p)),
  )

  const problem = draftError(effective, inputNames)
  const built = draftToSchedule(effective, inputNames, parametersGiven)

  const preview = useMemo(() => {
    if (problem || built.kind === 'event') return []

    const spec = z
      .union([
        z.object({ intervalMinutes: z.number() }),
        z.object({ dailyAt: z.string(), timeZone: z.string().optional() }),
        z.object({ cron: z.string(), timeZone: z.string().optional() }),
      ])
      .parse(built.spec)

    return upcomingRuns(built.kind, spec, new Date(), 3)
  }, [problem, built.kind, built.spec])

  const previewZone = z.string().catch('UTC').parse(built.spec.timeZone)

  const save = useMutation({
    mutationFn: () =>
      schedule
        ? updatePipelineSchedule(client, {
            workspaceId,
            scheduleId: schedule.id,
            kind: built.kind,
            spec: pipelineJsonObjectSchema.parse(built.spec),
          })
        : createPipelineSchedule(client, {
            workspaceId,
            definitionId,
            kind: built.kind,
            spec: pipelineJsonObjectSchema.parse(built.spec),
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.schedules(definitionId),
      })
      onOpenChange(false)
      toast(
        schedule
          ? t('data.scheduleDialog.triggerSaved')
          : t('data.scheduleDialog.triggerAdded'),
        {
          description: t('data.scheduleDialog.startsRunsPublishedVersion'),
        },
      )
    },
    onError: (error) =>
      setServerError(
        error instanceof Error
          ? error.message
          : t('data.scheduleDialog.databaseRefused'),
      ),
  })

  const patch = (next: Partial<ScheduleDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  const patchInput = (name: string, next: Partial<InputDraft>) =>
    setDraft((current) => ({
      ...current,
      inputs: {
        ...current.inputs,
        [name]: { ...(current.inputs[name] ?? blankInput()), ...next },
      },
    }))

  const title = schedule
    ? t('data.scheduleDialog.editTrigger')
    : t('data.scheduleDialog.newTrigger')

  return (
    <>
      <DialogHeader
        title={title}
        description={t('data.scheduleDialog.triggersStartRunsPublished')}
      />
      <DialogBody>
        <ScheduleTiming
          draft={draft}
          patch={patch}
          tried={tried}
          problem={problem}
        />
        <ScheduleEvent
          draft={draft}
          patch={patch}
          inputNames={inputNames}
          datasets={datasets.data ?? []}
          instruments={instruments.data ?? []}
        />
        <ScheduleInputs
          draft={draft}
          inputNames={inputNames}
          modeFor={modeFor}
          timed={timed}
          tried={tried}
          patchInput={patchInput}
          datasets={datasets.data ?? []}
          versionChoices={versionChoices.data ?? []}
        />
        <ScheduleParameters
          parameters={parameters}
          rawValue={rawValue}
          tried={tried}
          setParameter={(name, value) =>
            setDraft((current) => ({
              ...current,
              parameters: { ...current.parameters, [name]: value },
            }))
          }
        />
        <SchedulePolicy draft={draft} patch={patch} />
        <ScheduleFeedback
          preview={preview}
          previewZone={previewZone}
          tried={tried}
          problem={problem}
          parameterProblem={parameterProblem}
          serverError={serverError}
        />
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button type="button" />}>
          {t('common.actions.cancel')}
        </DialogClose>
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            setTried(true)

            if (problem || parameterProblem) return
            save.mutate()
          }}
        >
          {save.isPending
            ? t('common.states.saving')
            : schedule
              ? t('data.scheduleDialog.saveTrigger')
              : t('data.scheduleDialog.addTrigger')}
        </Button>
      </DialogFooter>
    </>
  )
}

interface DraftFieldsProps {
  draft: ScheduleDraft
  patch: (next: Partial<ScheduleDraft>) => void
}

function ScheduleTiming({
  draft,
  patch,
  tried,
  problem,
}: DraftFieldsProps & {
  tried: boolean
  problem: string | null
}) {
  const timed = draft.repeat !== 'event'
  const invalid = tried && problem ? true : undefined
  const zones = useMemo(() => knownTimeZones(), [])

  return (
    <>
      <Field label={t('data.scheduleDialog.runs')} required>
        <Select
          value={draft.repeat}
          onChange={(e) =>
            patch({
              repeat: z
                .enum([
                  'daily',
                  'weekdays',
                  'weekly',
                  'monthly',
                  'interval',
                  'cron',
                  'event',
                ])
                .parse(e.target.value),
            })
          }
        >
          {REPEATS.map((repeat) => (
            <option key={repeat} value={repeat}>
              {REPEAT_LABELS[repeat]}
            </option>
          ))}
        </Select>
      </Field>

      {draft.repeat === 'interval' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('data.scheduleDialog.every')} required>
            <Input
              type="number"
              min={1}
              value={draft.intervalValue}
              aria-invalid={invalid}
              onChange={(e) => patch({ intervalValue: e.target.value })}
            />
          </Field>
          <Field label={t('data.scheduleDialog.unit')}>
            <Select
              value={draft.intervalUnit}
              onChange={(e) =>
                patch({
                  intervalUnit: z
                    .enum(['minutes', 'hours', 'days'])
                    .parse(e.target.value),
                })
              }
            >
              <option value="minutes">
                {t('data.scheduleDialog.minutes')}
              </option>
              <option value="hours">{t('data.scheduleDialog.hours')}</option>
              <option value="days">{t('data.scheduleDialog.days')}</option>
            </Select>
          </Field>
        </div>
      ) : null}

      {['daily', 'weekdays', 'weekly', 'monthly'].includes(draft.repeat) ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {draft.repeat === 'weekly' ? (
            <Field label={t('data.scheduleDialog.on')}>
              <Select
                value={String(draft.weekday)}
                onChange={(e) => patch({ weekday: Number(e.target.value) })}
              >
                {WEEKDAYS.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {draft.repeat === 'monthly' ? (
            <Field label={t('data.scheduleDialog.dayMonth')}>
              <Input
                type="number"
                min={1}
                max={31}
                value={draft.monthDay}
                aria-invalid={invalid}
                onChange={(e) => patch({ monthDay: e.target.value })}
              />
            </Field>
          ) : null}
          <Field
            label={t('data.scheduleDialog.at')}
            required
            hint={t('data.scheduleDialog.n24HourTime')}
          >
            <Input
              type="time"
              value={draft.time}
              aria-invalid={invalid}
              onChange={(e) => patch({ time: e.target.value })}
            />
          </Field>
        </div>
      ) : null}

      {draft.repeat === 'cron' ? (
        <Field
          label={t('data.scheduleDialog.cronExpression')}
          required
          hint={t('data.scheduleDialog.minuteHourDayMonth')}
        >
          <Input
            className="mono"
            value={draft.cron}
            aria-invalid={invalid}
            onChange={(e) => patch({ cron: e.target.value })}
          />
        </Field>
      ) : null}

      {timed && draft.repeat !== 'interval' ? (
        <Field
          label={t('data.scheduleDialog.timeZone')}
          hint={t('data.scheduleDialog.clockTimeAboveRead')}
        >
          <Input
            list="pipeline-trigger-zones"
            value={draft.timeZone}
            aria-invalid={invalid}
            onChange={(e) => patch({ timeZone: e.target.value })}
          />
          <datalist id="pipeline-trigger-zones">
            {zones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Field>
      ) : null}
    </>
  )
}

function ScheduleEvent({
  draft,
  patch,
  inputNames,
  datasets,
  instruments,
}: DraftFieldsProps & {
  inputNames: string[]
  datasets: Array<{ id: string; label: string }>
  instruments: Array<{ id: string; name: string }>
}) {
  return (
    <>
      {draft.repeat === 'event' ? (
        <>
          <Field label={t('data.scheduleDialog.when')} required>
            <Select
              value={draft.eventType}
              onChange={(e) => patch({ eventType: e.target.value })}
            >
              {eventOptions().map(([name, label]) => (
                <option key={name} value={name}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {draft.eventType === 'dataset.versioned' ? (
            <>
              <Field
                label={t('data.scheduleDialog.onlyDataset')}
                hint={t('data.scheduleDialog.leaveEmptyReactAny')}
              >
                <Select
                  value={draft.datasetId}
                  onChange={(e) => patch({ datasetId: e.target.value })}
                >
                  <option value="">
                    {t('data.scheduleDialog.anyDataset')}
                  </option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('data.scheduleDialog.onlyImportsFromInstrument')}
                hint={t('data.scheduleDialog.leaveEmptyReactAny2')}
              >
                <Select
                  value={draft.instrumentId}
                  onChange={(e) => patch({ instrumentId: e.target.value })}
                >
                  <option value="">
                    {t('data.scheduleDialog.anyInstrument')}
                  </option>
                  {instruments.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {inputNames.length > 1 ? (
                <Field
                  label={t('data.scheduleDialog.bindNewVersion')}
                  hint={t('data.scheduleDialog.pipelineInputReceivesDataset')}
                >
                  <Select
                    value={draft.inputName}
                    onChange={(e) => patch({ inputName: e.target.value })}
                  >
                    <option value="">
                      {t('data.scheduleDialog.firstInputDefault')}
                    </option>
                    {inputNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}

function ScheduleInputs({
  draft,
  inputNames,
  modeFor,
  timed,
  tried,
  patchInput,
  datasets,
  versionChoices,
}: {
  draft: ScheduleDraft
  inputNames: string[]
  modeFor: (name: string) => InputMode
  timed: boolean
  tried: boolean
  patchInput: (name: string, next: Partial<InputDraft>) => void
  datasets: Array<{ id: string; label: string }>
  versionChoices: NonNullable<
    ReturnType<typeof useDatasetVersionChoices>['data']
  >
}) {
  return (
    <>
      {inputNames.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-border-subtle p-3">
          <span className="text-label font-medium text-fg">
            {t('data.scheduleDialog.whatEachRunReads')}
          </span>
          {inputNames.map((name) => {
            const mode = modeFor(name)
            const input = draft.inputs[name] ?? blankInput()

            if (mode === 'event') {
              return (
                <p key={name} className="m-0 text-body">
                  {rich('data.scheduleDialog.readsDatasetVersionStarted', {
                    name: <span className="mono">{name}</span>,
                  })}
                </p>
              )
            }

            const modes: Array<Exclude<InputMode, 'event'>> = timed
              ? ['latest', 'incremental', 'pinned']
              : ['latest', 'pinned']

            return (
              <div key={name} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label={
                    <>
                      {t('data.scheduleDialog.input')}{' '}
                      <span className="mono">{name}</span>
                    </>
                  }
                  hint={
                    mode === 'incremental'
                      ? t('data.scheduleDialog.runFindsNothingNew')
                      : mode === 'latest'
                        ? t('data.scheduleDialog.eachRunReadsWhatever')
                        : t('data.scheduleDialog.everyRunReadsExact')
                  }
                >
                  <Select
                    aria-label={t('data.scheduleDialog.ariaHowPicksData', {
                      name,
                    })}
                    value={mode}
                    onChange={(e) =>
                      patchInput(name, {
                        mode: z
                          .enum(['latest', 'incremental', 'pinned', 'event'])
                          .parse(e.target.value),
                      })
                    }
                  >
                    {modes.map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {mode === 'pinned' ? (
                  <Field
                    label={t('data.scheduleDialog.datasetVersion')}
                    error={
                      tried && !input.versionId
                        ? t('data.scheduleDialog.chooseVersion')
                        : undefined
                    }
                  >
                    <Select
                      aria-label={t('data.scheduleDialog.ariaDatasetVersion', {
                        name,
                      })}
                      value={input.versionId}
                      onChange={(e) =>
                        patchInput(name, { versionId: e.target.value })
                      }
                    >
                      <option value="">
                        {t('data.scheduleDialog.chooseDatasetVersion')}
                      </option>
                      {versionChoices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field
                    label={t('data.scheduleDialog.dataset')}
                    error={
                      tried && !input.datasetId
                        ? t('data.scheduleDialog.chooseDataset2')
                        : undefined
                    }
                  >
                    <Select
                      aria-label={t('data.scheduleDialog.ariaDatasetFor', {
                        name,
                      })}
                      value={input.datasetId}
                      onChange={(e) =>
                        patchInput(name, { datasetId: e.target.value })
                      }
                    >
                      <option value="">
                        {t('data.scheduleDialog.chooseDataset')}
                      </option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

function ScheduleParameters({
  parameters,
  rawValue,
  tried,
  setParameter,
}: {
  parameters: PipelineParameter[]
  rawValue: (parameter: PipelineParameter) => string
  tried: boolean
  setParameter: (name: string, value: string) => void
}) {
  return (
    <>
      {parameters.map((parameter) => {
        const raw = rawValue(parameter)
        const error = tried ? parameterError(parameter, raw) : undefined

        const set = (value: string) => setParameter(parameter.name, value)

        return (
          <Field
            key={parameter.name}
            label={
              <>
                {t('data.scheduleDialog.parameter')}{' '}
                <span className="mono">{parameter.name}</span>
              </>
            }
            required={parameter.required}
            hint={
              parameter.description ??
              t('data.scheduleDialog.everyRunTriggerStarts')
            }
            error={error}
          >
            {parameter.type === 'boolean' ? (
              <Select
                aria-label={t('data.scheduleDialog.ariaParameter', {
                  name: parameter.name,
                })}
                value={raw}
                onChange={(e) => set(e.target.value)}
              >
                <option value="">{t('data.scheduleDialog.notSet')}</option>
                <option value="true">{t('data.scheduleDialog.yes')}</option>
                <option value="false">{t('data.scheduleDialog.no')}</option>
              </Select>
            ) : (
              <Input
                aria-label={t('data.scheduleDialog.ariaParameter', {
                  name: parameter.name,
                })}
                type={parameter.type === 'date' ? 'date' : 'text'}
                value={raw}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </Field>
        )
      })}
    </>
  )
}

function SchedulePolicy({ draft, patch }: DraftFieldsProps) {
  const timed = draft.repeat !== 'event'

  const policyLabel = timed
    ? t('data.scheduleDialog.ifServerDownWhen')
    : t('data.scheduleDialog.eventsArriveWhileTrigger')

  return (
    <Field
      label={policyLabel}
      hint={
        timed
          ? t('data.scheduleDialog.runMoreThanMinutes', {
              MISSED_RUN_GRACE_MINUTES,
            })
          : t('data.scheduleDialog.skippingIgnoresWhatHappened')
      }
    >
      <Select
        aria-label={policyLabel}
        value={draft.missedRunPolicy}
        onChange={(e) =>
          patch({
            missedRunPolicy: z.enum(['run_once', 'skip']).parse(e.target.value),
          })
        }
      >
        <option value="run_once">
          {timed
            ? t('data.scheduleDialog.runOnceWhenBack')
            : t('data.scheduleDialog.processThemResume')}
        </option>
        <option value="skip">
          {timed
            ? t('data.scheduleDialog.skipWhatMissed')
            : t('data.scheduleDialog.ignoreThem')}
        </option>
      </Select>
    </Field>
  )
}

function ScheduleFeedback({
  preview,
  previewZone,
  tried,
  problem,
  parameterProblem,
  serverError,
}: {
  preview: Date[]
  previewZone: string
  tried: boolean
  problem: string | null
  parameterProblem: boolean
  serverError: string | null
}) {
  return (
    <>
      {preview.length > 0 ? (
        <Notice tone="info">
          {t('data.scheduleDialog.nextRunsClock', {
            previewZone,
            join: preview
              .map((at) =>
                dateTimeFormat('en-GB', {
                  timeZone: previewZone,
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZoneName: 'short',
                  ...clockOption(),
                }).format(at),
              )
              .join(' · '),
          })}
        </Notice>
      ) : null}
      {tried && (problem || parameterProblem) ? (
        <Notice tone="bad">
          {problem ?? t('data.scheduleDialog.fillParametersMarkedAbove')}
        </Notice>
      ) : null}
      {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
    </>
  )
}

function blankInput(): InputDraft {
  return { mode: 'latest', datasetId: '', versionId: '' }
}
