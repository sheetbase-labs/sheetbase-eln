import { Dot } from '#/components/ui/status'
import type { Tone } from '#/components/ui/status'
import { cn } from '#/lib/utils'

/** What the state line is about: a review, a warning, a problem or a plain note. */
export type RecordStateTone = 'review' | 'warn' | 'bad' | 'info'

const WASH: Record<RecordStateTone, string> = {
  review: 'bg-review-wash',
  warn: 'bg-warning-wash',
  bad: 'bg-danger-wash',
  info: 'bg-surface-muted',
}

const DOT: Record<RecordStateTone, Tone> = {
  review: 'review',
  warn: 'warn',
  bad: 'bad',
  info: 'stored',
}

/**
 * The one line a record page says about its state, under its title: in
 * review, expiring, quarantined, read-only. It takes the place of banners
 * stacked above the content and of badges in the pane header, so the state is
 * said once, where the eye already is. A page shows one at most.
 */
export function RecordStateLine({
  tone,
  children,
  action,
}: {
  tone: RecordStateTone
  children: React.ReactNode
  /** One link or quiet button that acts on the state. */
  action?: React.ReactNode
}) {
  return (
    <div
      data-record-state={tone}
      role="status"
      className={cn(
        'flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-1.5 text-label text-fg',
        WASH[tone],
      )}
    >
      <span className="flex min-w-0 flex-1 basis-60 items-center gap-2">
        <Dot tone={DOT[tone]} />
        <span className="min-w-0 text-pretty">{children}</span>
      </span>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  )
}
