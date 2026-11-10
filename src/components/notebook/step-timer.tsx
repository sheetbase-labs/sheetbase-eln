import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'
import { toast } from '#/components/ui/sonner'
import { cn } from '#/lib/utils'
import { recordPath } from '#/lib/navigation'
import {
  endStepTimer,
  fetchMyStepTimers,
  finishedTimers,
  formatCountdown,
  formatDuration,
  nextEndInMs,
  remainingMs,
  startStepTimer,
  stepTimerQueryKeys,
} from '#/lib/step-timers'
import type { StepTimer } from '#/lib/step-timers'
import {
  alertTimerFinished,
  claimAlert,
  notificationPermission,
  prepareTimerAlerts,
} from '#/lib/step-timer-alert'
import { useWakeLock } from '#/lib/pwa/wake-lock'

/** The caller's own running and finished timers, kept fresh across tabs and devices. */
export function useStepTimers(enabled = true) {
  return useQuery({
    queryKey: stepTimerQueryKeys.all,
    queryFn: () => fetchMyStepTimers(),
    enabled,
    // Another device or tab may start or stop a timer.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 10_000,
  })
}

/** The current time, ticking every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    // A hidden tab may not tick; catch up the moment it is shown again.
    const onVisible = () => setNow(Date.now())
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])

  return now
}

function useTimerActions() {
  const queryClient = useQueryClient()

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: stepTimerQueryKeys.all })

  const start = useMutation({
    mutationFn: async (blockId: string) => {
      // Asked from this tap, which is the only time a browser allows it.
      await prepareTimerAlerts()

      return startStepTimer(blockId)
    },
    onSuccess: refresh,
    onError: () => toast.error(t('notebook.stepTimers.couldNotStart')),
  })

  const end = useMutation({
    mutationFn: (timerId: string) => endStepTimer(timerId),
    onSuccess: refresh,
    onError: () => toast.error(t('notebook.stepTimers.couldNotStop')),
  })

  return { start, end }
}

/**
 * Start, watch and stop the timer for one step. Shown under a step that has a
 * duration. Starting a timer is not an edit to the record, so it works on a
 * locked or signed notebook too.
 */
export function StepTimerControl({
  blockId,
  durationSeconds,
  className,
}: {
  blockId: string
  durationSeconds: number
  className?: string
}) {
  const timers = useStepTimers()
  const { start, end } = useTimerActions()
  const timer = timers.data?.find((candidate) => candidate.blockId === blockId)
  const now = useNow(Boolean(timer))
  const length = formatDuration(durationSeconds)
  const left = timer ? remainingMs(timer, now) : 0
  const done = Boolean(timer) && left === 0

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      data-testid="step-timer"
      data-keep-preview
      // The preview opens its block for editing when clicked; a timer button is not an edit.
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {!timer ? (
        <Button
          size="sm"
          icon="clock"
          disabled={start.isPending}
          onClick={() => start.mutate(blockId)}
        >
          {t('notebook.stepTimers.startFor', { length })}
        </Button>
      ) : done ? (
        <>
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-success-text"
          >
            <Icon name="check" size={14} />
            {t('notebook.stepTimers.finished')}
          </span>
          <Button
            size="sm"
            disabled={start.isPending}
            onClick={() => start.mutate(blockId)}
          >
            {t('notebook.stepTimers.restart')}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={end.isPending}
            onClick={() => end.mutate(timer.id)}
          >
            {t('notebook.stepTimers.dismiss')}
          </Button>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
            <Icon name="clock" size={14} className="text-fg-muted" />
            <span className="font-medium">
              {t('notebook.stepTimers.timeLeft', {
                time: formatCountdown(left),
              })}
            </span>
          </span>
          <Button
            size="sm"
            variant="quiet"
            disabled={end.isPending}
            onClick={() => end.mutate(timer.id)}
          >
            {t('notebook.stepTimers.stop')}
          </Button>
        </>
      )}
      {timer && notificationPermission() === 'denied' ? (
        <span className="text-xs text-fg-muted">
          {t('notebook.stepTimers.alertsBlocked')}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Lives in the app shell, so a timer keeps counting and alerts wherever the
 * person has navigated. It alerts once per timer per device when the timer ends
 * (or the moment the page comes back if it ended while the phone was asleep),
 * and lists running and finished timers in a small tray.
 */
export function StepTimersHost() {
  const timers = useStepTimers()
  const { end } = useTimerActions()
  const list = timers.data ?? []
  const now = useNow(list.length > 0)

  // Schedule the alert for the exact second the next timer ends; the 1s tick and
  // the refetch on focus cover a browser that delays or freezes this one.
  const queryClient = useQueryClient()
  const nextMs = nextEndInMs(list, now)
  React.useEffect(() => {
    if (nextMs === null) return

    const id = window.setTimeout(
      () =>
        void queryClient.invalidateQueries({
          queryKey: stepTimerQueryKeys.all,
        }),
      Math.min(nextMs + 250, 2_000_000_000),
    )

    return () => window.clearTimeout(id)
  }, [nextMs, queryClient])

  const finished = finishedTimers(list, now)
  React.useEffect(() => {
    for (const timer of finished) {
      if (!claimAlert(timer.id)) continue
      void alertTimerFinished(timer.id, timer.label, recordPath(timer.recordId))
    }
  }, [finished])

  // A phone that dims mid-timer may stop counting and alerting, so keep the
  // screen on while any timer is still running.
  useWakeLock(list.some((timer) => remainingMs(timer, now) > 0))

  // The browser tab shows the soonest countdown, for when the tab is in the background.
  const soonest = list
    .filter((timer) => remainingMs(timer, now) > 0)
    .sort((a, b) => remainingMs(a, now) - remainingMs(b, now))
    .at(0)

  React.useEffect(() => {
    if (!soonest) return
    const base = document.title.replace(/^[\d:]+ · /, '')
    document.title = `${formatCountdown(remainingMs(soonest, now))} · ${base}`

    return () => {
      document.title = base
    }
  })

  if (list.length === 0) return null

  return (
    <section
      aria-label={t('notebook.stepTimers.tray.ariaLabel')}
      className="pointer-events-none fixed bottom-10 left-3 z-40 flex max-w-[calc(100vw-1.5rem)] flex-col gap-2 max-md:bottom-20"
    >
      {list.map((timer) => (
        <TrayTimer
          key={timer.id}
          timer={timer}
          now={now}
          onDismiss={() => end.mutate(timer.id)}
        />
      ))}
    </section>
  )
}

function TrayTimer({
  timer,
  now,
  onDismiss,
}: {
  timer: StepTimer
  now: number
  onDismiss: () => void
}) {
  const left = remainingMs(timer, now)
  const done = left === 0

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-72 max-w-full items-center gap-3 rounded-lg border bg-surface px-3 py-2 shadow-lg',
        done ? 'border-success' : 'border-border',
      )}
    >
      <Icon
        name={done ? 'check' : 'clock'}
        size={16}
        className={done ? 'text-success-text' : 'text-fg-muted'}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-semibold tabular-nums',
            done && 'text-success-text',
          )}
        >
          {done
            ? t('notebook.stepTimers.finishedTitle')
            : t('notebook.stepTimers.timeLeft', {
                time: formatCountdown(left),
              })}
        </p>
        <Link
          to={recordPath(timer.recordId)}
          title={t('notebook.stepTimers.tray.openStep')}
          className="block truncate text-xs text-fg-muted hover:text-fg"
        >
          {timer.label}
        </Link>
      </div>
      <Button size="sm" variant="quiet" onClick={onDismiss}>
        {done
          ? t('notebook.stepTimers.dismiss')
          : t('notebook.stepTimers.stop')}
      </Button>
    </div>
  )
}
