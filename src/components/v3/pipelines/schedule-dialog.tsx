import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Select } from '#/components/v3/ui/select'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { toast } from '#/components/v3/ui/sonner'
import {
  pipelineDataQueryKeys,
  useDatasetVersionChoices,
} from '#/components/v3/pipelines/pipelines-data'
import {
  parameterError,
  parameterValue,
} from '#/components/v3/pipelines/run-dialog'
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { notebookDataClient } from '#/lib/notebook-data'
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

const REPEATS: Repeat[] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'interval',
  'cron',
  'event',
]

/** The zone the form starts on: the person's own, else the browser's. */
export function defaultTimeZone(): string {
  return (
    getDisplayTimeZone() ??
    (typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined) ??
    'UTC'
  )
}

/** Every IANA zone this browser knows, for the zone field's suggestions. */
function knownTimeZones(): string[] {
  try {
    return (
      (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.('timeZone') ?? ['UTC']
    )
  } catch {
    return ['UTC']
  }
}

function useDatasetOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'trigger-dataset-options'],
    enabled,
    queryFn: async (): Promise<Array<{ id: string; label: string }>> => {
      const rows = await notebookDataClient.list<{
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

function useInstrumentOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'trigger-instruments'],
    enabled,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> =>
      notebookDataClient.list<{ id: string; name: string }>(
        'instruments',
        '?select=id,name&order=name.asc',
      ),
    staleTime: 60_000,
  })
}

const MODE_LABELS: Record<Exclude<InputMode, 'event'>, string> = {
  latest: 'Latest version of a Dataset',
  incremental: 'Only when the Dataset has a new version',
  pinned: 'One fixed Dataset Version',
}

/**
 * Create or edit a trigger. Everything the database will check is checked
 * here first with the same rules, so a trigger that cannot work is refused
 * before the request leaves the page — and the form shows when the first runs
 * will be, on the trigger's own clock, so the schedule can be read back.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  schedule,
  definitionId,
  workspaceId,
  inputs,
  parameters,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing this trigger; absent when adding one. */
  schedule?: PipelineScheduleWire
  definitionId: string
  workspaceId: string
  inputs: PipelineInput[]
  parameters: PipelineParameter[]
}) {
  const queryClient = useQueryClient()
  const inputNames = useMemo(() => inputs.map((i) => i.name), [inputs])
  const initial = useMemo((): ScheduleDraft => {
    const zone = defaultTimeZone()
    if (schedule) return scheduleToDraft(schedule, inputNames, zone)
    const draft = emptyDraft(zone)
    // New triggers follow the latest data: pinning is the opt-in, not the
    // default, so a daily trigger does not read the same old version forever.
    for (const name of inputNames) {
      draft.inputs[name] = { mode: 'latest', datasetId: '', versionId: '' }
    }
    for (const p of parameters) {
      if (p.default !== undefined) draft.parameters[p.name] = String(p.default)
    }
    return draft
  }, [schedule, inputNames, parameters])
  const [draft, setDraft] = useState<ScheduleDraft>(initial)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setDraft(initial)
      setTried(false)
      setServerError(null)
    }
  }, [open, initial])

  const timed = draft.repeat !== 'event'
  const datasets = useDatasetOptions(open)
  const instruments = useInstrumentOptions(
    open && draft.repeat === 'event' && draft.eventType === 'dataset.versioned',
  )
  const versionChoices = useDatasetVersionChoices(
    open && Object.values(draft.inputs).some((i) => i?.mode === 'pinned'),
  )
  const zones = useMemo(() => knownTimeZones(), [])

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
    draft.parameters[p.name] ??
    (p.default === undefined ? '' : String(p.default))
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
    return upcomingRuns(built.kind, built.spec as never, new Date(), 3)
  }, [problem, built.kind, built.spec])
  const previewZone =
    typeof built.spec.timeZone === 'string' ? built.spec.timeZone : 'UTC'

  const save = useMutation({
    mutationFn: () =>
      schedule
        ? updatePipelineSchedule(notebookDataClient, {
            workspaceId,
            scheduleId: schedule.id,
            kind: built.kind,
            spec: built.spec,
          })
        : createPipelineSchedule(notebookDataClient, {
            workspaceId,
            definitionId,
            kind: built.kind,
            spec: built.spec,
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.schedules(definitionId),
      })
      onOpenChange(false)
      toast(schedule ? 'Trigger saved' : 'Trigger added', {
        description:
          'It starts runs of the published version. Pause it any time.',
      })
    },
    onError: (error: unknown) =>
      setServerError(
        error instanceof Error ? error.message : 'The database refused it.',
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

  const title = schedule ? 'Edit trigger' : 'New trigger'
  const policyLabel = timed
    ? `If the server is down when a run is due`
    : 'Events that arrive while the trigger is paused'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(600px,calc(100vw-32px))]">
        <DialogHeader
          title={title}
          description="Triggers start runs of the published version. They never sign, submit or approve anything."
        />
        <DialogBody>
          <Field label="Runs" required>
            <Select
              value={draft.repeat}
              onChange={(e) => patch({ repeat: e.target.value as Repeat })}
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
              <Field label="Every" required>
                <Input
                  type="number"
                  min={1}
                  value={draft.intervalValue}
                  aria-invalid={tried && problem ? true : undefined}
                  onChange={(e) => patch({ intervalValue: e.target.value })}
                />
              </Field>
              <Field label="Unit">
                <Select
                  value={draft.intervalUnit}
                  onChange={(e) =>
                    patch({
                      intervalUnit: e.target
                        .value as ScheduleDraft['intervalUnit'],
                    })
                  }
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </Select>
              </Field>
            </div>
          ) : null}

          {['daily', 'weekdays', 'weekly', 'monthly'].includes(draft.repeat) ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {draft.repeat === 'weekly' ? (
                <Field label="On">
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
                <Field label="On day of the month">
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={draft.monthDay}
                    aria-invalid={tried && problem ? true : undefined}
                    onChange={(e) => patch({ monthDay: e.target.value })}
                  />
                </Field>
              ) : null}
              <Field label="At" required hint="24-hour time.">
                <Input
                  type="time"
                  value={draft.time}
                  aria-invalid={tried && problem ? true : undefined}
                  onChange={(e) => patch({ time: e.target.value })}
                />
              </Field>
            </div>
          ) : null}

          {draft.repeat === 'cron' ? (
            <Field
              label="Cron expression"
              required
              hint="Minute, hour, day of month, month, day of week. For example 0 9 * * 1-5 is 09:00 on weekdays."
            >
              <Input
                className="mono"
                value={draft.cron}
                aria-invalid={tried && problem ? true : undefined}
                onChange={(e) => patch({ cron: e.target.value })}
              />
            </Field>
          ) : null}

          {timed && draft.repeat !== 'interval' ? (
            <Field
              label="Time zone"
              hint="The clock the time above is read on, so 09:00 stays 09:00 when the clocks change."
            >
              <Input
                list="pipeline-trigger-zones"
                value={draft.timeZone}
                aria-invalid={tried && problem ? true : undefined}
                onChange={(e) => patch({ timeZone: e.target.value })}
              />
              <datalist id="pipeline-trigger-zones">
                {zones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </Field>
          ) : null}

          {draft.repeat === 'event' ? (
            <>
              <Field label="When" required>
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
                    label="Only this Dataset"
                    hint="Leave empty to react to any Dataset."
                  >
                    <Select
                      value={draft.datasetId}
                      onChange={(e) => patch({ datasetId: e.target.value })}
                    >
                      <option value="">Any Dataset</option>
                      {(datasets.data ?? []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Only imports from this instrument"
                    hint="Leave empty to react to any source."
                  >
                    <Select
                      value={draft.instrumentId}
                      onChange={(e) => patch({ instrumentId: e.target.value })}
                    >
                      <option value="">Any instrument</option>
                      {(instruments.data ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {inputNames.length > 1 ? (
                    <Field
                      label="Bind the new version to"
                      hint="The pipeline input that receives the Dataset Version that started the run."
                    >
                      <Select
                        value={draft.inputName}
                        onChange={(e) => patch({ inputName: e.target.value })}
                      >
                        <option value="">First input (default)</option>
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

          {inputNames.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-md border border-border-subtle p-3">
              <span className="text-label font-medium text-fg">
                What each run reads
              </span>
              {inputNames.map((name) => {
                const mode = modeFor(name)
                const input = draft.inputs[name] ?? blankInput()
                if (mode === 'event') {
                  return (
                    <p key={name} className="m-0 text-body">
                      <span className="mono">{name}</span> reads the Dataset
                      Version that started the run.
                    </p>
                  )
                }
                const modes: Array<Exclude<InputMode, 'event'>> = timed
                  ? ['latest', 'incremental', 'pinned']
                  : ['latest', 'pinned']
                return (
                  <div
                    key={name}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                  >
                    <Field
                      label={
                        <>
                          Input <span className="mono">{name}</span>
                        </>
                      }
                      hint={
                        mode === 'incremental'
                          ? 'A run that finds nothing new does nothing, and says so.'
                          : mode === 'latest'
                            ? 'Each run reads whatever is newest when it starts.'
                            : 'Every run reads this exact version.'
                      }
                    >
                      <Select
                        aria-label={`How ${name} picks its data`}
                        value={mode}
                        onChange={(e) =>
                          patchInput(name, {
                            mode: e.target.value as InputMode,
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
                        label="Dataset Version"
                        error={
                          tried && !input.versionId
                            ? 'Choose a version.'
                            : undefined
                        }
                      >
                        <Select
                          aria-label={`Dataset Version for ${name}`}
                          value={input.versionId}
                          onChange={(e) =>
                            patchInput(name, { versionId: e.target.value })
                          }
                        >
                          <option value="">Choose a Dataset Version…</option>
                          {(versionChoices.data ?? []).map((choice) => (
                            <option key={choice.id} value={choice.id}>
                              {choice.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : (
                      <Field
                        label="Dataset"
                        error={
                          tried && !input.datasetId
                            ? 'Choose a Dataset.'
                            : undefined
                        }
                      >
                        <Select
                          aria-label={`Dataset for ${name}`}
                          value={input.datasetId}
                          onChange={(e) =>
                            patchInput(name, { datasetId: e.target.value })
                          }
                        >
                          <option value="">Choose a Dataset…</option>
                          {(datasets.data ?? []).map((d) => (
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

          {parameters.map((parameter) => {
            const raw = rawValue(parameter)
            const error = tried ? parameterError(parameter, raw) : undefined
            const set = (value: string) =>
              setDraft((current) => ({
                ...current,
                parameters: { ...current.parameters, [parameter.name]: value },
              }))
            return (
              <Field
                key={parameter.name}
                label={
                  <>
                    Parameter <span className="mono">{parameter.name}</span>
                  </>
                }
                required={parameter.required}
                hint={
                  parameter.description ??
                  'Every run this trigger starts gets this value.'
                }
                error={error}
              >
                {parameter.type === 'boolean' ? (
                  <Select
                    aria-label={`Parameter ${parameter.name}`}
                    value={raw}
                    onChange={(e) => set(e.target.value)}
                  >
                    <option value="">Not set</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </Select>
                ) : (
                  <Input
                    aria-label={`Parameter ${parameter.name}`}
                    type={parameter.type === 'date' ? 'date' : 'text'}
                    value={raw}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </Field>
            )
          })}

          <Field
            label={policyLabel}
            hint={
              timed
                ? `A run more than ${MISSED_RUN_GRACE_MINUTES} minutes late counts as missed.`
                : 'Skipping ignores what happened while it was paused.'
            }
          >
            <Select
              aria-label={policyLabel}
              value={draft.missedRunPolicy}
              onChange={(e) =>
                patch({
                  missedRunPolicy: e.target
                    .value as ScheduleDraft['missedRunPolicy'],
                })
              }
            >
              <option value="run_once">
                {timed ? 'Run once when it is back' : 'Process them on resume'}
              </option>
              <option value="skip">
                {timed ? 'Skip what was missed' : 'Ignore them'}
              </option>
            </Select>
          </Field>

          {preview.length > 0 ? (
            <Notice tone="info">
              Next runs, on the {previewZone} clock:{' '}
              {preview
                .map((at) =>
                  new Intl.DateTimeFormat('en-GB', {
                    timeZone: previewZone,
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZoneName: 'short',
                  }).format(at),
                )
                .join(' · ')}
            </Notice>
          ) : null}
          {tried && (problem || parameterProblem) ? (
            <Notice tone="bad">
              {problem ?? 'Fill in the parameters marked above.'}
            </Notice>
          ) : null}
          {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
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
              ? 'Saving…'
              : schedule
                ? 'Save trigger'
                : 'Add trigger'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blankInput(): InputDraft {
  return { mode: 'latest', datasetId: '', versionId: '' }
}
