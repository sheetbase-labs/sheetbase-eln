import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Status } from '#/components/v3/ui/status'
import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Choice } from '#/components/v3/ui/choice'
import { RadioGroup } from '#/components/v3/ui/radio-group'
import { Muted, Section } from '#/components/v3/ui/layout'
import { NativeSelect } from '#/components/v3/projects/select'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from '#/components/v3/ui/confirm-dialog'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { toast } from '#/components/v3/ui/sonner'
import {
  createPipelineSchedule,
  deletePipelineSchedule,
  updatePipelineSchedule,
} from '#/lib/pipelines/data'
import type { PipelineScheduleKind } from '#/lib/pipelines/types'
import {
  PIPELINE_TRIGGER_EVENTS,
  validateScheduleSpec,
} from '#/lib/pipeline-schedule'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  pipelineDataQueryKeys,
  usePipelineVersions,
  useSchedules,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): pipeline triggers. Schedules are created,
 * enabled, disabled and deleted through the api RPCs. */
export const Route = createFileRoute('/pipelines/$pipelineId/triggers')({
  component: PipelineTriggers,
})

/** The stored spec written the way the schedule reads: an interval in minutes
 * or hours, a daily wall-clock time in its zone, or the event name with its
 * Dataset filter. A spec this build cannot read renders as a gap, never as raw
 * jsonb. */
export function scheduleSpecLabel(
  kind: PipelineScheduleKind,
  spec: Record<string, unknown>,
  datasetNames: Map<string, string>,
): string {
  if (kind === 'interval') {
    const minutes = spec.intervalMinutes
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '—'
    if (minutes >= 60 && minutes % 60 === 0) return `Every ${minutes / 60} h`
    return `Every ${minutes} min`
  }
  if (kind === 'daily') {
    const at = spec.dailyAt
    if (typeof at !== 'string' || !at) return '—'
    const zone =
      typeof spec.timeZone === 'string' && spec.timeZone ? spec.timeZone : 'UTC'
    return `Daily at ${at} (${zone})`
  }
  const eventType = spec.eventType
  if (typeof eventType !== 'string' || !eventType) return '—'
  const datasetId = typeof spec.datasetId === 'string' ? spec.datasetId : null
  if (!datasetId) return eventType
  return `${eventType} · ${datasetNames.get(datasetId) ?? 'Dataset no longer readable'}`
}

/** Dataset id → name, for the Dataset filter an event trigger names. Only read
 * when a caller actually has an id to resolve. */
function useDatasetNames(enabled: boolean) {
  const query = useQuery({
    queryKey: ['ui-port', 'pipelines', 'trigger-datasets'],
    enabled,
    queryFn: async (): Promise<Map<string, string>> => {
      const rows = await notebookDataClient.list<{ id: string; name: string }>(
        'datasets',
        '?select=id,name&order=name.asc',
      )
      return new Map(rows.map((row) => [row.id, row.name]))
    },
    staleTime: 60_000,
  })
  return query.data ?? new Map<string, string>()
}

function PipelineTriggers() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()
  const schedules = useSchedules(pipelineId)
  const rows = schedules.data ?? []
  const datasetNames = useDatasetNames(
    rows.some((s) => typeof s.spec.datasetId === 'string'),
  )
  // The sweep starts a triggered run on the latest PUBLISHED version, so a
  // trigger on a pipeline that has none is enabled but cannot fire. The row
  // must not keep advertising a next run in that state; `null` means the
  // answer is not known yet, so no inert claim is made while it loads.
  const versions = usePipelineVersions(pipelineId)
  const hasPublishedVersion = versions.isSuccess
    ? versions.data.some((v) => v.lifecycle === 'published')
    : null

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: pipelineDataQueryKeys.schedules(pipelineId),
    })

  const toggle = useMutation({
    mutationFn: (input: { scheduleId: string; enabled: boolean }) =>
      updatePipelineSchedule(notebookDataClient, {
        workspaceId,
        scheduleId: input.scheduleId,
        enabled: input.enabled,
      }),
    onSuccess: (updated) => {
      void invalidate()
      toast(updated.enabled ? 'Trigger enabled' : 'Trigger paused')
    },
    onError: (error: unknown) =>
      toast('Could not change the trigger', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  const remove = useMutation({
    mutationFn: (scheduleId: string) =>
      deletePipelineSchedule(notebookDataClient, { workspaceId, scheduleId }),
    onSuccess: () => {
      void invalidate()
      toast('Trigger deleted')
    },
    onError: (error: unknown) =>
      toast('Could not delete the trigger', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      }),
  })

  // A timed trigger whose stored spec this build cannot read has no next run:
  // nothing will schedule it, so the page says so rather than leaving a blank.
  const uninterpretable = rows.filter(
    (s) =>
      s.kind !== 'event' &&
      !s.next_run_at &&
      scheduleSpecLabel(s.kind, s.spec, datasetNames) === '—',
  )

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <Section
        title="Triggers"
        count={rows.length}
        action={
          <NewTrigger definitionId={pipelineId} workspaceId={workspaceId} />
        }
      >
        {uninterpretable.length ? (
          <Notice tone="warn">
            {uninterpretable.length === 1
              ? '1 trigger’s stored specification cannot be interpreted, so it has no next run and will not fire. Delete it and add a new trigger to restore the schedule.'
              : `${uninterpretable.length} triggers’ stored specifications cannot be interpreted, so they have no next run and will not fire. Delete them and add new triggers to restore the schedules.`}
          </Notice>
        ) : null}
        {hasPublishedVersion === false && rows.length ? (
          <Notice tone="warn">
            This pipeline has no published version, so its triggers will not
            fire. Publish a version to activate them.
          </Notice>
        ) : null}
        {rows.length ? (
          <TableBox>
            <Table aria-label="Pipeline triggers">
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>Spec</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead align="right">{''}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.kind}</TableCell>
                    <TableCell className="text-caption">
                      {scheduleSpecLabel(s.kind, s.spec, datasetNames)}
                    </TableCell>
                    <TableCell>
                      <Status tone={s.enabled ? 'ok' : 'stored'}>
                        {s.enabled ? 'Enabled' : 'Paused'}
                      </Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {hasPublishedVersion === false
                        ? 'No published version'
                        : s.next_run_at
                          ? s.next_run_at.slice(0, 16).replace('T', ' ')
                          : s.kind === 'event'
                            ? 'On its event'
                            : 'Never fires'}
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({
                              scheduleId: s.id,
                              enabled: !s.enabled,
                            })
                          }
                        >
                          {s.enabled ? 'Pause' : 'Enable'}
                        </Button>
                        <ConfirmDialog>
                          <ConfirmDialogTrigger>
                            <Button
                              size="sm"
                              variant="quiet"
                              disabled={remove.isPending}
                            >
                              Delete
                            </Button>
                          </ConfirmDialogTrigger>
                          <ConfirmDialogContent>
                            <ConfirmDialogHeader>
                              <ConfirmDialogTitle>
                                Delete this trigger?
                              </ConfirmDialogTitle>
                              <ConfirmDialogDescription>
                                Runs it would have started will not happen, and
                                deleting cannot be undone. Add a new trigger if
                                the pipeline should still run on a schedule or
                                an event.
                              </ConfirmDialogDescription>
                            </ConfirmDialogHeader>
                            <ConfirmDialogFooter>
                              <ConfirmDialogCancel />
                              <ConfirmDialogAction
                                variant="danger-fill"
                                onClick={() => remove.mutate(s.id)}
                              >
                                Delete trigger
                              </ConfirmDialogAction>
                            </ConfirmDialogFooter>
                          </ConfirmDialogContent>
                        </ConfirmDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="calendar"
            title="No triggers"
            body="A pipeline runs when someone presses Run now until a trigger is added."
            className="py-4"
          />
        )}
      </Section>
      <Muted className="mt-4">
        Triggers start runs; they never sign, submit, approve or delete.
      </Muted>
    </div>
  )
}

/** Add a trigger: an interval, a daily wall-clock time, or a catalogue event.
 * The spec is validated with the same rules the RPC applies, so an invalid
 * trigger is refused before the request leaves the page. */
function NewTrigger({
  definitionId,
  workspaceId,
}: {
  definitionId: string
  workspaceId: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const empty = {
    kind: 'daily' as PipelineScheduleKind,
    intervalMinutes: '60',
    dailyAt: '09:00',
    timeZone: '',
    eventType: PIPELINE_TRIGGER_EVENTS[0] ?? '',
    datasetId: '',
  }
  const [f, setF] = useState(empty)
  const datasetNames = useDatasetNames(open && f.kind === 'event')

  const spec: Record<string, unknown> =
    f.kind === 'interval'
      ? { intervalMinutes: Number(f.intervalMinutes) }
      : f.kind === 'daily'
        ? {
            dailyAt: f.dailyAt.trim(),
            ...(f.timeZone.trim() ? { timeZone: f.timeZone.trim() } : {}),
          }
        : {
            eventType: f.eventType,
            ...(f.datasetId ? { datasetId: f.datasetId } : {}),
          }
  const specError = validateScheduleSpec(f.kind, spec)
  const specErrorMessage = !specError
    ? null
    : f.kind === 'interval'
      ? 'Enter how many minutes between runs, from 1 to 525600.'
      : f.kind === 'daily'
        ? /timeZone/.test(specError.message)
          ? 'Enter a valid IANA time zone, e.g. Europe/London, or leave it empty for UTC.'
          : 'Enter the time of day as HH:MM.'
        : 'Choose the event that starts the run.'

  const create = useMutation({
    mutationFn: () =>
      createPipelineSchedule(notebookDataClient, {
        workspaceId,
        definitionId,
        kind: f.kind,
        spec,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: pipelineDataQueryKeys.schedules(definitionId),
      })
      setOpen(false)
      setF(empty)
      setTried(false)
      toast('Trigger added', {
        description:
          'It starts runs of the published version. Pause it any time.',
      })
    },
    onError: (error: unknown) => {
      setServerError(
        error instanceof Error ? error.message : 'The database refused it.',
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setF(empty)
          setTried(false)
          setServerError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="primary" icon="plus" />}>
        New trigger
      </DialogTrigger>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="New trigger"
          description="Triggers start runs of the published version. They never sign, submit or approve anything."
        />
        <DialogBody>
          <RadioGroup
            aria-label="What starts the run"
            value={f.kind}
            onValueChange={(value) =>
              setF({ ...f, kind: value as PipelineScheduleKind })
            }
          >
            <span className="text-label font-medium text-fg">
              What starts the run
            </span>
            <Choice value="daily" title="Every day at a time">
              Once a day at a wall-clock time in a named time zone.
            </Choice>
            <Choice value="interval" title="On an interval">
              Every N minutes while the trigger is enabled.
            </Choice>
            <Choice value="event" title="On an event">
              When a workspace event happens, e.g. a Dataset gains a version.
            </Choice>
          </RadioGroup>

          {f.kind === 'interval' ? (
            <Field
              label="Every"
              required
              hint="Minutes between runs, 1 to 525600."
            >
              <Input
                type="number"
                min={1}
                max={525600}
                value={f.intervalMinutes}
                aria-invalid={tried && specErrorMessage ? true : undefined}
                onChange={(e) =>
                  setF({ ...f, intervalMinutes: e.target.value })
                }
              />
            </Field>
          ) : null}

          {f.kind === 'daily' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Time of day" required hint="24-hour HH:MM.">
                <Input
                  type="time"
                  value={f.dailyAt}
                  aria-invalid={tried && specErrorMessage ? true : undefined}
                  onChange={(e) => setF({ ...f, dailyAt: e.target.value })}
                />
              </Field>
              <Field
                label="Time zone"
                hint="IANA name, e.g. Europe/London. Empty means UTC."
              >
                <Input
                  value={f.timeZone}
                  aria-invalid={tried && specErrorMessage ? true : undefined}
                  onChange={(e) => setF({ ...f, timeZone: e.target.value })}
                />
              </Field>
            </div>
          ) : null}

          {f.kind === 'event' ? (
            <>
              <Field label="Event" required>
                <NativeSelect
                  value={f.eventType}
                  aria-invalid={tried && specErrorMessage ? true : undefined}
                  onChange={(e) => setF({ ...f, eventType: e.target.value })}
                >
                  {PIPELINE_TRIGGER_EVENTS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {f.eventType === 'dataset.versioned' ? (
                <Field
                  label="Dataset filter"
                  hint="Only this Dataset's new versions start the run. Optional."
                >
                  <NativeSelect
                    value={f.datasetId}
                    onChange={(e) => setF({ ...f, datasetId: e.target.value })}
                  >
                    <option value="">Any dataset</option>
                    {[...datasetNames].map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
            </>
          ) : null}

          {tried && specErrorMessage ? (
            <Notice tone="bad">{specErrorMessage}</Notice>
          ) : null}
          {serverError ? <Notice tone="bad">{serverError}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTried(true)
              if (specError) return
              create.mutate()
            }}
          >
            {create.isPending ? 'Adding…' : 'Add trigger'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
