/**
 * The lab's working hours: when the scheduler may place hands-on work. Part of
 * Settings > General; saved on its own.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import { Section } from '#/components/ui/layout'
import { isIanaTimeZone } from '#/lib/pipeline-schedule'
import {
  fetchSchedulerSettings,
  minuteToTime,
  saveSchedulerSettings,
  scheduleQueryKeys,
  timeToMinute,
} from '#/lib/scheduler'
import { DEFAULT_HOURS } from '#/lib/scheduler/plan'

const client = notebookDataClient
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

export function WorkingHoursSettings({
  workspaceId,
  canManage = true,
}: {
  workspaceId: string
  canManage?: boolean
}) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: scheduleQueryKeys.settings,
    queryFn: () => fetchSchedulerSettings(client),
    staleTime: 30_000,
  })

  const [timezone, setTimezone] = useState<string>(DEFAULT_HOURS.timezone)

  const [start, setStart] = useState(() =>
    minuteToTime(DEFAULT_HOURS.startMinute),
  )

  const [end, setEnd] = useState(() => minuteToTime(DEFAULT_HOURS.endMinute))
  const [days, setDays] = useState<number[]>([...DEFAULT_HOURS.days])

  useEffect(() => {
    if (query.data === undefined) return

    if (query.data) {
      setTimezone(query.data.timezone)
      setStart(minuteToTime(query.data.work_start_minute))
      setEnd(minuteToTime(query.data.work_end_minute))
      setDays(query.data.work_days)
    }
  }, [query.data])

  const startMinute = timeToMinute(start)
  const endMinute = timeToMinute(end)

  const problem =
    startMinute === null || endMinute === null
      ? t('automation.schedule.hours.problemTime')
      : endMinute <= startMinute
        ? t('automation.schedule.hours.problemOrder')
        : days.length === 0
          ? t('automation.schedule.hours.problemDays')
          : !isIanaTimeZone(timezone.trim())
            ? t('automation.schedule.hours.problemZone')
            : null

  const save = useMutation({
    mutationFn: () =>
      saveSchedulerSettings(client, {
        workspaceId,
        timezone: timezone.trim(),
        startMinute: startMinute ?? 0,
        endMinute: endMinute ?? 0,
        days: [...days].sort((left, right) => left - right),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: scheduleQueryKeys.settings,
      })
      toast.success(t('automation.schedule.hours.saved'))
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : t('automation.schedule.hours.couldNotSave'),
      ),
  })

  return (
    <Section title={t('automation.schedule.hours.title')}>
      <p className="m-0 text-label text-fg-muted">
        {t('automation.schedule.hours.hint')}
      </p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_120px]">
        <Field label={t('automation.schedule.hours.timezone')}>
          <Input
            value={timezone}
            disabled={!canManage}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </Field>
        <Field label={t('automation.schedule.hours.start')}>
          <Input
            value={start}
            disabled={!canManage}
            inputMode="numeric"
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label={t('automation.schedule.hours.end')}>
          <Input
            value={end}
            disabled={!canManage}
            inputMode="numeric"
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('automation.schedule.hours.days')}>
        <span className="flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAYS.map((day) => (
            <label key={day} className="flex items-center gap-2 text-body">
              <Checkbox
                checked={days.includes(day)}
                disabled={!canManage}
                onCheckedChange={(checked) =>
                  setDays((c) =>
                    checked === true
                      ? [...new Set([...c, day])]
                      : c.filter((d) => d !== day),
                  )
                }
              />
              {t(`automation.schedule.hours.weekdays.${day}`)}
            </label>
          ))}
        </span>
      </Field>
      {problem ? (
        <p role="alert" className="m-0 text-label text-danger-text">
          {problem}
        </p>
      ) : null}
      {canManage ? (
        <div>
          <Button
            size="sm"
            disabled={save.isPending || problem !== null || query.isPending}
            onClick={() => save.mutate()}
          >
            {t('automation.schedule.hours.save')}
          </Button>
        </div>
      ) : null}
    </Section>
  )
}
