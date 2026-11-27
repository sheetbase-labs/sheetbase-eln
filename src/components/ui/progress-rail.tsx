import { cn } from '#/lib/utils'

/** One segment of a progress rail: a step, part or stage of a run. */
export interface RailSegment {
  key: string
  state: 'done' | 'now' | 'todo'
  /** Shown on hover, so a segment can be matched to its step. */
  title?: string
}

/**
 * A run's progress at a glance: one bar per step, green when done, blue for
 * the one under way, empty for the rest. It repeats what the list beside it
 * says, so it is hidden from assistive technology.
 */
export function ProgressRail({
  segments,
  className,
}: {
  segments: readonly RailSegment[]
  className?: string
}) {
  if (segments.length < 2) return null

  return (
    <div
      aria-hidden
      className={cn('flex gap-1', className)}
      data-testid="step-rail"
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          title={segment.title}
          data-state={segment.state}
          className={cn(
            'h-1 min-w-0 flex-1 rounded-[1px] transition-colors duration-300 ease-out',
            segment.state === 'done'
              ? 'bg-success'
              : segment.state === 'now'
                ? 'bg-link'
                : 'bg-border',
          )}
        />
      ))}
    </div>
  )
}
