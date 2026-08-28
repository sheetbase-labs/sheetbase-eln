/**
 * AUTO-03 — Pipeline schedule/event triggers for a definition. interval and
 * daily schedules run the latest published version with fixed inputs and
 * parameters; event schedules fire when the platform sweep observes matching
 * dataset_version_created change events.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Switch,
} from '#/components/ui'
import type { DataClient } from '#/lib/data-client'
import type { PipelineConfig } from '#/lib/pipelines/config'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'
import {
  createPipelineSchedule,
  deletePipelineSchedule,
  listPipelineSchedules,
  pipelineQueryKeys,
  updatePipelineSchedule,
} from '#/lib/pipelines/data'

export function PipelineSchedules({
  dataClient,
  workspaceId,
  definitionId,
  config,
  canManage,
}: {
  dataClient: DataClient
  workspaceId: string
  definitionId: string
  config: PipelineConfig
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)

  const schedulesQuery = useQuery({
    queryKey: pipelineQueryKeys.schedules,
    queryFn: () => listPipelineSchedules(dataClient),
    enabled: Boolean(workspaceId),
  })

  const toggleMutation = useMutation({
    mutationFn: (schedule: PipelineScheduleWire) =>
      updatePipelineSchedule(dataClient, {
        workspaceId,
        scheduleId: schedule.id,
        enabled: !schedule.enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.schedules })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (scheduleId: string) =>
      deletePipelineSchedule(dataClient, { workspaceId, scheduleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.schedules })
    },
  })

  const schedules =
    schedulesQuery.data?.filter((s) => s.definition_id === definitionId) ?? []

  if (!canManage) {
    return (
      <p className="text-muted-foreground text-sm">
        Only owners, admins and stewards manage schedules.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Schedules & event triggers</h3>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No schedules yet. Add an interval, daily or dataset-version-created
          event trigger.
        </p>
      ) : (
        <div className="space-y-2">
          {schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {describeSchedule(schedule)}
                </p>
                <p className="text-muted-foreground text-xs">
                  next:{' '}
                  {schedule.next_run_at
                    ? schedule.next_run_at.slice(0, 16).replace('T', ' ')
                    : 'event-driven'}{' '}
                  ·{' '}
                  {schedule.last_run_at
                    ? `last run ${schedule.last_run_at.slice(0, 16).replace('T', ' ')}`
                    : 'never run'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={schedule.enabled ? 'default' : 'secondary'}>
                  {schedule.enabled ? 'enabled' : 'paused'}
                </Badge>
                <Switch
                  checked={schedule.enabled}
                  onCheckedChange={() => toggleMutation.mutate(schedule)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="delete schedule"
                  onClick={() => removeMutation.mutate(schedule.id)}
                  disabled={removeMutation.isPending}
                >
                  {removeMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddScheduleDialog
        dataClient={dataClient}
        workspaceId={workspaceId}
        definitionId={definitionId}
        inputs={config.inputs.map((i) => i.name)}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  )
}

function describeSchedule(schedule: PipelineScheduleWire): string {
  if (schedule.kind === 'interval') {
    const minutes = Number(schedule.spec.intervalMinutes ?? '')
    return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  if (schedule.kind === 'daily') {
    return `Daily at ${schedule.spec.dailyAt}`
  }
  return schedule.spec.datasetId
    ? `On new Dataset Version of ${String(schedule.spec.datasetId).slice(0, 8)}`
    : 'On any new Dataset Version'
}

function AddScheduleDialog({
  dataClient,
  workspaceId,
  definitionId,
  inputs,
  open,
  onOpenChange,
}: {
  dataClient: DataClient
  workspaceId: string
  definitionId: string
  inputs: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<'interval' | 'daily' | 'event'>('interval')
  const [intervalMinutes, setIntervalMinutes] = useState('30')
  const [dailyAt, setDailyAt] = useState('09:00')
  const [eventInput, setEventInput] = useState(inputs[0] ?? '')
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: () => {
      const spec: Record<string, unknown> =
        kind === 'interval'
          ? { intervalMinutes: Number(intervalMinutes) }
          : kind === 'daily'
            ? { dailyAt }
            : { eventType: 'dataset_version_created', inputName: eventInput }
      return createPipelineSchedule(dataClient, {
        workspaceId,
        definitionId,
        kind,
        spec,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineQueryKeys.schedules })
      setError('')
      onOpenChange(false)
    },
    onError: (cause: unknown) => {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create the schedule.',
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add schedule</DialogTitle>
          <DialogDescription>
            Runs the latest published version of this Pipeline with its fixed
            inputs and parameters (v1: fixed-input schedules).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Kind</Label>
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
              aria-label="schedule kind"
            >
              <option value="interval">Interval</option>
              <option value="daily">Daily</option>
              <option value="event">Dataset Version created</option>
            </Select>
          </div>

          {kind === 'interval' && (
            <div className="space-y-2">
              <Label>Minutes</Label>
              <Input
                type="number"
                min={1}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(event.target.value)}
              />
            </div>
          )}
          {kind === 'daily' && (
            <div className="space-y-2">
              <Label>Time (HH:MM)</Label>
              <Input
                value={dailyAt}
                onChange={(event) => setDailyAt(event.target.value)}
                placeholder="09:00"
              />
            </div>
          )}
          {kind === 'event' && inputs.length > 0 && (
            <div className="space-y-2">
              <Label>Input that receives the new Dataset Version</Label>
              <Select
                value={eventInput}
                onChange={(event) => setEventInput(event.target.value)}
                aria-label="event input"
              >
                {inputs.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              createMutation.isPending ||
              (kind === 'interval' && Number(intervalMinutes) < 1) ||
              (kind === 'daily' &&
                !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(dailyAt))
            }
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Add schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
