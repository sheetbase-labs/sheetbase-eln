import { CodeBlock } from '#/components/v3/ui/code-block'
import { Muted } from '#/components/v3/ui/layout'
import type { PipelineRunLogWire } from '#/lib/pipelines/types'

/**
 * What a Python step left in a log entry's `detail`: its own print output, the
 * line its code failed on, and the interpreter and package versions it ran with.
 * The detail is stored JSON, so each field is checked before it is shown, and
 * everything is rendered as text.
 */
export interface PythonLogDetail {
  step?: string
  lines: string[]
  line?: number
  python?: string
  packages: Array<[string, string]>
}

export function pythonLogDetail(
  detail: Record<string, unknown>,
): PythonLogDetail | null {
  const lines = Array.isArray(detail.logs)
    ? detail.logs.filter((line): line is string => typeof line === 'string')
    : []
  const environment =
    detail.environment !== null && typeof detail.environment === 'object'
      ? (detail.environment as Record<string, unknown>)
      : null
  const python =
    typeof environment?.python === 'string' ? environment.python : undefined
  const packages =
    environment?.packages !== null && typeof environment?.packages === 'object'
      ? Object.entries(environment.packages as Record<string, unknown>).flatMap(
          ([name, version]): Array<[string, string]> =>
            typeof version === 'string' ? [[name, version]] : [],
        )
      : []
  const line =
    typeof detail.line === 'number' && Number.isInteger(detail.line)
      ? detail.line
      : undefined
  if (!lines.length && !python && !packages.length && line === undefined)
    return null
  return {
    step: typeof detail.step === 'string' ? detail.step : undefined,
    lines,
    line,
    python,
    packages,
  }
}

/** The run's log: one line per entry, with a Python step's output under its entry. */
export function RunLog({ logs }: { logs: PipelineRunLogWire[] }) {
  if (!logs.length) return <Muted>No log lines recorded.</Muted>
  return (
    <ol className="m-0 flex list-none flex-col gap-1 rounded-md border border-border bg-surface p-3 font-mono text-caption">
      {logs.map((entry) => {
        const python = pythonLogDetail(entry.detail)
        return (
          <li key={entry.id} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <span className="text-fg-muted">{entry.at.slice(11, 19)}</span>
              <span
                className={
                  entry.level === 'error'
                    ? 'text-danger-text'
                    : entry.level === 'warning'
                      ? 'text-warning-text'
                      : undefined
                }
              >
                {entry.stage}
              </span>
              <span>{entry.message}</span>
            </div>
            {python ? (
              <div
                data-slot="python-log"
                className="ml-[4.5rem] flex flex-col gap-1 font-sans"
              >
                {python.python ? (
                  <Muted className="text-caption">
                    Python {python.python}
                    {python.packages.length
                      ? ` · ${python.packages
                          .map(([name, version]) => `${name} ${version}`)
                          .join(', ')}`
                      : ''}
                  </Muted>
                ) : null}
                {python.line !== undefined ? (
                  <Muted className="text-caption">
                    Failed at line {python.line}
                    {python.step ? ` of step ${python.step}` : ''}.
                  </Muted>
                ) : null}
                {python.lines.length ? (
                  <details open={entry.level === 'error'}>
                    <summary className="cursor-pointer text-caption text-fg-muted">
                      Output ({python.lines.length}{' '}
                      {python.lines.length === 1 ? 'line' : 'lines'})
                    </summary>
                    <CodeBlock
                      code={python.lines.join('\n')}
                      label={`Python output${python.step ? `, ${python.step}` : ''}`}
                      maxHeight="md"
                    />
                  </details>
                ) : null}
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
