import { formatListDate } from '#/lib/list-date'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

const DAY = 24 * 60 * 60 * 1000

/** Whole days from `today` to `due`, both `YYYY-MM-DD`; negative when past. */
export function daysUntil(due: string, today: string): number {
  return Math.round(
    (Date.parse(`${due.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) /
      DAY,
  )
}

/**
 * A due date as a list reads it. Late work is a warm chip that says how late,
 * the next few days say how soon, and anything further off, or already
 * finished, is the plain date, so only what needs attention stands out.
 */
export function DueChip({
  due,
  now,
  done = false,
  className,
}: {
  /** The planned day, `YYYY-MM-DD` or an ISO instant. */
  due: string
  now: Date
  /** Finished work keeps its date but never reads as late. */
  done?: boolean
  className?: string
}) {
  const days = daysUntil(due, now.toISOString())
  const date = formatListDate(due, now)

  if (done || days > 6) {
    return <span className={cn('text-fg-muted', className)}>{date}</span>
  }

  const label =
    days < 0
      ? t('common.due.late', { count: -days })
      : days === 0
        ? t('common.due.today')
        : days === 1
          ? t('common.due.tomorrow')
          : t('common.due.inDays', { count: days })

  return (
    <span
      title={date}
      data-due={days < 0 ? 'late' : 'soon'}
      className={cn(
        'inline-flex h-5 max-w-full items-center truncate rounded-[4px]',
        // A filled chip pulls its padding back, so its words line up with
        // the plain dates above and below it.
        days < 0
          ? '-ml-1.5 bg-warning-wash px-1.5 text-label text-warning-text'
          : days <= 1
            ? '-ml-1.5 bg-surface-hover px-1.5 text-label text-fg'
            : 'text-fg-muted',
        className,
      )}
    >
      {label}
    </span>
  )
}
