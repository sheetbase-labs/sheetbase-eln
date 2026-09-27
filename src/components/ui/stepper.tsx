import { cn } from '#/lib/utils'

/**
 * Stepper (DSYS-04): a horizontal 3–5 step progress row. Steps before
 * `current` are done, `current` is now (or bad when `failed`), and the rest
 * are pending.
 */
export interface StepperProps {
  steps: string[]
  current: number
  failed?: boolean
  className?: string
}

export function Stepper({ steps, current, failed, className }: StepperProps) {
  return (
    <ol
      data-slot="stepper"
      className={cn(
        'flex list-none flex-wrap items-center gap-2 p-0 text-caption',
        className,
      )}
    >
      {steps.map((step, index) => {
        const state =
          index < current
            ? 'done'
            : index === current
              ? failed
                ? 'bad'
                : 'now'
              : 'todo'
        return (
          <li
            key={step}
            data-state={state}
            className={cn(
              'flex items-center gap-1.5 text-muted-foreground',
              state === 'now' && 'font-medium text-foreground',
            )}
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className="mr-0.5 h-px w-6 bg-border-strong"
              />
            ) : null}
            <span
              className={cn(
                'inline-flex size-[18px] items-center justify-center rounded-full border border-border-strong bg-card text-[11px] font-semibold',
                state === 'done' &&
                  'border-muted-foreground bg-muted-foreground text-card',
                state === 'now' &&
                  'border-primary bg-primary text-primary-foreground',
                state === 'bad' &&
                  'border-danger-text bg-danger-text text-primary-foreground',
              )}
            >
              {index + 1}
            </span>
            {step}
          </li>
        )
      })}
    </ol>
  )
}
