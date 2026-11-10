import { t } from '#/copy'
import { z } from 'zod'
import { CodeBlock } from '#/components/ui/code-block'
import { Muted } from '#/components/ui/layout'
import {
  pipelineJsonObjectSchema,
  pipelineJsonValueSchema,
} from '#/lib/pipelines/types'
import type { PythonEnvironment } from '#/lib/pipelines/python'
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
  python?: PythonEnvironment['python']
  packages: Array<[string, PythonEnvironment['packages'][string]]>
}

const logDetailSchema = z.object({
  logs: z
    .array(pipelineJsonValueSchema)
    .catch([])
    .transform((lines) =>
      lines.flatMap((line) => {
        const parsed = z.string().safeParse(line)

        return parsed.success ? [parsed.data] : []
      }),
    ),
  environment: z
    .object({
      python: z.string().optional().catch(undefined),
      packages: z
        .union([pipelineJsonObjectSchema, z.array(pipelineJsonValueSchema)])
        .catch({})
        .transform((packages) =>
          Object.entries(packages).flatMap(
            ([name, version]): PythonLogDetail['packages'] => {
              const parsed = z.string().safeParse(version)

              return parsed.success ? [[name, parsed.data]] : []
            },
          ),
        ),
    })
    .optional()
    .catch(undefined),
  line: z.number().refine(Number.isInteger).optional().catch(undefined),
  step: z.string().optional().catch(undefined),
})

function pythonLogDetail(
  detail: PipelineRunLogWire['detail'],
): PythonLogDetail | null {
  const parsed = logDetailSchema.parse(detail)
  const lines = parsed.logs
  const python = parsed.environment?.python
  const packages = parsed.environment?.packages ?? []
  const line = parsed.line

  if (!lines.length && !python && !packages.length && line === undefined)
    return null

  return {
    step: parsed.step,
    lines,
    line,
    python,
    packages,
  }
}

/** The run's log: one line per entry, with a Python step's output under its entry. */
export function RunLog({ logs }: { logs: PipelineRunLogWire[] }) {
  if (!logs.length) return <Muted>{t('data.runLog.logLinesRecorded')}</Muted>

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
                    {t('data.runLog.python', { python: python.python })}
                    {python.packages.length
                      ? ` · ${python.packages
                          .map(([name, version]) => `${name} ${version}`)
                          .join(', ')}`
                      : ''}
                  </Muted>
                ) : null}
                {python.line !== undefined ? (
                  <Muted className="text-caption">
                    {python.step
                      ? t('data.runLog.failedLineStep', {
                          line: python.line,
                          step: python.step,
                        })
                      : t('data.runLog.failedLine', { line: python.line })}
                  </Muted>
                ) : null}
                {python.lines.length ? (
                  <details open={entry.level === 'error'}>
                    <summary className="cursor-pointer text-caption text-fg-muted">
                      {t('data.runLog.output', { count: python.lines.length })}
                    </summary>
                    <CodeBlock
                      code={python.lines.join('\n')}
                      label={
                        python.step
                          ? t('data.runLog.pythonOutputStep', {
                              step: python.step,
                            })
                          : t('data.runLog.pythonOutput')
                      }
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
