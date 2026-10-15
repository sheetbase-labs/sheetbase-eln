import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/v3/icons'
import { Muted } from '#/components/v3/ui/layout'
import { cn } from '#/lib/utils'

/**
 * R5-SHELL-06 — presentation of pipeline code, temporary stores and step
 * navigation for the pipeline Overview.
 *
 * **Highlighting is deferred, deliberately.** No syntax highlighter is a
 * dependency of this repository (checked 11 October 2026: no `shiki`,
 * `prismjs`, `highlight.js`, `refractor`, `lowlight` or
 * `react-syntax-highlighter` in `package.json`, and none installs
 * transitively), and the app-3 interface hand-rolled its own token colours
 * rather than using one. Adding a highlighter for its own sake would be new
 * weight, not new information, so a code block names its language and renders
 * the statement as plain text.
 *
 * **The code is text.** It is placed in the tree as a text node, never through
 * `dangerouslySetInnerHTML`, and nothing here executes, evaluates or
 * interprets it.
 */

/**
 * Code is text (R5-SHELL-06). A statement that is not valid UTF-16 (lone
 * surrogates, as produced by truncated or mis-decoded bytes) or that carries a
 * NUL is shown with U+FFFD instead, so a corrupt statement renders as visibly
 * broken text rather than throwing or smuggling a control character into the
 * DOM. Valid characters, including astral pairs, pass through unchanged.
 */
export function codeText(value: string): string {
  let out = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    const loneSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff
    out += loneSurrogate || codePoint === 0 ? '\uFFFD' : character
  }
  return out
}

export interface CodeBlockProps {
  /** The statement exactly as stored. */
  code: string
  /** The stored language, e.g. `sql`; omitted when the config does not say. */
  language?: string
  /** Accessible name for the scrollable code region. */
  label: string
  className?: string
}

/**
 * A readable code block. Long statements scroll horizontally — the scroll
 * container is focusable so a keyboard user can reach the whole line — and an
 * empty statement says so instead of rendering an empty box.
 */
export function CodeBlock({
  code,
  language,
  label,
  className,
}: CodeBlockProps) {
  const text = codeText(code)
  return (
    <div
      data-slot="code-block"
      className={cn('flex flex-col gap-1', className)}
    >
      {language ? (
        <span
          data-slot="code-language"
          className="mono text-[10px] tracking-[.02em] text-fg-muted uppercase"
        >
          {language}
        </span>
      ) : null}
      {text.trim().length === 0 ? (
        <p
          data-slot="code-block-empty"
          className="m-0 rounded-md border border-dashed border-border-strong bg-surface p-3 text-caption text-fg-muted"
        >
          Empty statement.
        </p>
      ) : (
        <pre
          data-slot="code-block-pre"
          tabIndex={0}
          role="group"
          aria-label={label}
          className="m-0 overflow-auto rounded-md border border-border bg-surface p-3 text-caption whitespace-pre focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <code className="mono">{text}</code>
        </pre>
      )}
    </div>
  )
}

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
}: {
  pipelineId: string
  steps: PipelineStepConfig[]
}) {
  return (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => (
        <div
          key={`${step.name}-${index}`}
          className="flex flex-col gap-1.5"
          data-slot="pipeline-step"
        >
          <span className="text-label font-semibold">
            {index + 1} · {step.name} · {step.language}
          </span>
          <CodeBlock
            code={step.statement}
            label={`Step ${index + 1}, ${step.name}, statement`}
          />
          <TemporaryResultNote />
        </div>
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
