import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/v3/icons'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Muted } from '#/components/v3/ui/layout'
import { cn } from '#/lib/utils'

/**
 * R5-SHELL-06 — presentation of pipeline code, temporary stores and step
 * navigation for the pipeline Overview.
 *
 * **The code block belongs to the kit.** It began here, as the one deliberate
 * payload renderer in an app that otherwise hand-rolled `<pre>` per screen; it
 * now lives at `#/components/v3/ui/code-block` so the four other payload
 * surfaces can use it too, and this module keeps only what is about pipelines.
 * Its two standing decisions travelled with it: the code is text and is never
 * interpreted, and highlighting stays deferred rather than becoming a
 * dependency.
 */

/**
 * An artefact whose store is temporary (R5-SHELL-06). The badge names the
 * store and the rule that ends it; the retention rule a person can act on is
 * stated next to the control that decides it, not only here.
 */
export function TemporaryArtefact({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-slot="temporary-artefact"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border border-dashed border-border-strong px-[5px] text-[11px] leading-4 whitespace-nowrap text-fg-muted',
        className,
      )}
    >
      <Icon name="clock" size={11} />
      {children}
    </span>
  )
}

export interface PipelineStepConfig {
  name: string
  language: string
  statement: string
}

/**
 * Step navigation stays a route (R5-SHELL-06). `/pipelines/$pipelineId/steps`
 * is already linkable — it is the shell's Steps tab and edits the stored
 * configuration — so it is not converted to a `?step=n` parameter for
 * symmetry with the app-3 interface, whose step picker drove a single editor.
 */
export const pipelineStepsRoute = '/pipelines/$pipelineId/steps' as const

/** The link to the step editor, with no search parameter (R5-SHELL-06). */
export function pipelineStepsLink(pipelineId: string) {
  return { to: pipelineStepsRoute, params: { pipelineId } }
}

/**
 * What happens to a transform's result (R5-SHELL-06). Intermediate step tables
 * are session temp tables dropped when the run ends; only the run's declared
 * output is written through a governed RPC and kept
 * (docs/subsystems/pipelines.md).
 */
export function TemporaryResultNote() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TemporaryArtefact>Temporary result</TemporaryArtefact>
      <Muted className="text-caption">
        Its table exists only while the run is going and is dropped when the run
        ends. Only the declared output is kept.
      </Muted>
    </div>
  )
}

/**
 * The stored steps, in run order, each with its code and what happens to its
 * result.
 */
export function PipelineSteps({
  pipelineId,
  steps,
  transform,
}: {
  pipelineId: string
  steps: PipelineStepConfig[]
  transform?: PipelineStepConfig
}) {
  return (
    <div className="flex flex-col gap-3">
      {(transform ? [transform, ...steps] : steps).map((step, index) => (
        <details
          key={`${step.name}-${index}`}
          open={index === 0}
          className="border-b border-border pb-3"
          data-slot="pipeline-step"
        >
          <summary className="cursor-pointer text-body font-medium focus-visible:outline-2 focus-visible:outline-focus">
            {index + 1} · {step.name} · {step.language}
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            <CodeBlock
              code={step.statement}
              label={`Step ${index + 1}, ${step.name}, statement`}
            />
            <TemporaryResultNote />
          </div>
        </details>
      ))}
      <Link
        {...pipelineStepsLink(pipelineId)}
        className="text-link self-start text-label"
      >
        Edit steps
      </Link>
    </div>
  )
}
