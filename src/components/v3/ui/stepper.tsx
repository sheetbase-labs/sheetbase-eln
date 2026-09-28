import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

export function Stepper({
  steps,
  current,
  failed,
  className,
  label = 'Steps',
}: {
  steps: string[]
  current: number
  failed?: boolean
  className?: string
  label?: string
}) {
  return (
    <ol
      aria-label={label}
      className={cn(
        'm-0 flex list-none items-center gap-2 p-0 text-label',
        className,
      )}
    >
      {steps.map((s, i) => {
        const n = i + 1
        const state =
          n < current
            ? 'done'
            : n === current
              ? failed
                ? 'bad'
                : 'now'
              : 'todo'
        return (
          <li
            key={s}
            aria-current={n === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1.5 text-fg-muted [&+&]:before:mr-0.5 [&+&]:before:h-px [&+&]:before:w-6 [&+&]:before:bg-border-strong [&+&]:before:content-[""]',
              state === 'now' && 'font-medium text-fg',
            )}
          >
            <span
              className={cn(
                'inline-flex size-[18px] items-center justify-center rounded-full border border-border-strong bg-surface text-[11px] font-semibold',
                state === 'done' && 'border-fg-muted bg-fg-muted text-surface',
                state === 'now' && 'border-primary bg-primary text-on-accent',
                state === 'bad' &&
                  'border-danger-text bg-danger-text text-on-accent',
              )}
            >
              {state === 'done' ? (
                <Icon name="check" size={10} strokeWidth={2} />
              ) : state === 'bad' ? (
                '!'
              ) : (
                n
              )}
            </span>
            {s}
          </li>
        )
      })}
    </ol>
  )
}
