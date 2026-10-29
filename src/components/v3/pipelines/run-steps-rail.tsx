import { t } from '#/copy'
import { cn } from '#/lib/utils'
import type { RunStep, RunStepState } from '#/lib/pipelines/run-steps'

const BADGE: Record<RunStepState, { glyph: string | null; className: string }> =
  {
    done: { glyph: '✓', className: 'border-success text-success' },
    failed: { glyph: '!', className: 'border-danger text-danger' },
    waiting: { glyph: '?', className: 'border-warning text-warning' },
    running: { glyph: '…', className: 'border-link text-link' },
    not_started: { glyph: null, className: 'border-border text-fg-muted' },
  }

/** The run's steps down the left: where it got to, and what each step is. */
export function RunStepsRail({ steps }: { steps: RunStep[] }) {
  if (!steps.length) return null
  return (
    <nav
      aria-label={t('data.runStepsRail.ariaRunSteps')}
      className="flex w-[232px] shrink-0 flex-col gap-1 border-r border-border px-3 py-4 max-lg:w-full max-lg:border-r-0 max-lg:border-b"
    >
      <h2 className="m-0 px-1 pb-1 font-sans text-label font-semibold">
        {t('data.runStepsRail.steps')}
      </h2>
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
        {steps.map((step) => {
          const badge = BADGE[step.state]
          const attention = step.state === 'failed' || step.state === 'waiting'
          return (
            <li
              key={step.index}
              aria-current={attention ? 'step' : undefined}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1.5',
                attention && 'bg-surface-sunken',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-caption',
                  badge.className,
                )}
              >
                {badge.glyph ?? step.index}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-label">{step.label}</span>
                <span className="text-caption text-fg-muted">{step.note}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
