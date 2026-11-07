/**
 * Code cell block: Python or SQL on dataset versions, run in the pipeline
 * sandbox. The output is kept in the block with the code, the inputs' digests
 * and the image it ran in, so a signed notebook shows exactly what was run, and
 * a run can be run again to see whether it comes out the same.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { SqlEditor } from '#/components/pipelines/sql-editor'
import { Notice } from '#/components/ui/alert'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'
import {
  CODE_CELL_LANGUAGES,
  MAX_CODE_CELL_INPUTS,
  isCodeCellLanguage,
  outputIsStale,
  requestCodeCellRun,
  starterSource,
} from '#/lib/code-cells/code-cell'
import type {
  CodeCellInput,
  CodeCellLanguage,
  CodeCellOutput,
  CodeCellPayload,
} from '#/lib/code-cells/code-cell'
import { notebookDataClient, formatRelativeTime } from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { AutosaveStatus, SaveResult } from './use-autosave'

const client = notebookDataClient
const PREVIEW_ROWS = 10

function payloadOf(value: unknown): CodeCellPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function shortDigest(digest: string | null | undefined): string {
  if (!digest) return '—'
  const [algorithm, hex] = digest.split(':')
  return hex ? `${algorithm}:${hex.slice(0, 12)}…` : digest.slice(0, 20)
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** The output of a run: the first rows, and what was kept with it. */
function CodeCellOutputView({
  output,
  stale,
}: {
  output: CodeCellOutput
  stale: boolean
}) {
  const shown = output.rows.slice(0, PREVIEW_ROWS)
  return (
    <div className="flex flex-col gap-2" aria-label={t('automation.codeCell.outputLabel')}>
      <p className="m-0 flex flex-wrap items-center gap-2 text-label text-fg-muted">
        <span className="mono">{output.reference}</span>
        {t('automation.codeCell.ranAt', {
          when: formatRelativeTime(output.ranAt),
        })}
        {output.status === 'ok' ? (
          <Badge>
            {t('automation.codeCell.rows', { count: output.rowCount })}
          </Badge>
        ) : null}
      </p>
      {stale ? <Notice tone="warn">{t('automation.codeCell.stale')}</Notice> : null}
      {output.status === 'error' ? (
        <Notice tone="bad">
          {t('automation.codeCell.failed', {
            message: output.errorMessage ?? '',
          })}
        </Notice>
      ) : shown.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('automation.codeCell.noRows')}
        </p>
      ) : (
        <>
          <TableBox className="max-h-[320px] overflow-auto">
            <Table aria-label={t('automation.codeCell.outputLabel')}>
              <TableHeader>
                <TableRow>
                  {output.columns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody colSpan={Math.max(output.columns.length, 1)}>
                {shown.map((row, index) => (
                  <TableRow key={index}>
                    {output.columns.map((column) => (
                      <TableCell key={column} className="truncate">
                        {cellText(row[column])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
          {output.rowCount > shown.length ? (
            <p className="m-0 text-label text-fg-muted">
              {t('automation.codeCell.firstRows', {
                shown: shown.length,
                count: output.rowCount,
              })}
            </p>
          ) : null}
        </>
      )}
      {output.logs && output.logs.length > 0 ? (
        <pre className="m-0 max-h-32 overflow-auto rounded-md bg-surface-muted p-2 font-mono text-label text-fg-muted">
          {output.logs.join('\n')}
        </pre>
      ) : null}
      <Provenance output={output} />
    </div>
  )
}

function Provenance({ output }: { output: CodeCellOutput }) {
  return (
    <dl
      aria-label={t('automation.codeCell.provenance.title')}
      className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-label text-fg-muted"
    >
      <dt>{t('automation.codeCell.provenance.code')}</dt>
      <dd className="mono m-0 truncate">{shortDigest(output.sourceDigest)}</dd>
      <dt>{t('automation.codeCell.provenance.output')}</dt>
      <dd className="mono m-0 truncate">{shortDigest(output.outputDigest)}</dd>
      <dt>{t('automation.codeCell.provenance.image')}</dt>
      <dd className="mono m-0 truncate" title={output.runtime ?? undefined}>
        {output.runtime === 'postgres-sandbox'
          ? t('automation.codeCell.provenance.sandbox')
          : (output.runtime ?? '—')}
      </dd>
      {output.inputs.map((input) => (
        <FragmentRow key={input.alias} label={t('automation.codeCell.provenance.input', { alias: input.alias })}>
          {input.label} · {shortDigest(input.digest)}
        </FragmentRow>
      ))}
    </dl>
  )
}

function FragmentRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="mono m-0 truncate">{children}</dd>
    </>
  )
}

/** Read-only: the code, what it reads and the output it produced. */
export function CodeCellBlockPreview({
  payload,
}: {
  payload: unknown
  recordId?: string
}) {
  const cell = payloadOf(payload)
  const language = isCodeCellLanguage(cell.language) ? cell.language : 'python'
  const output = cell.output ?? null
  if (!cell.source && !output) {
    return (
      <p className="m-0 text-label text-fg-muted">
        {t('automation.codeCell.emptyPreview')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-label text-fg-muted">
        <Badge>{t(`automation.codeCell.languages.${language}`)}</Badge>
        {(cell.inputs ?? []).map((input) => (
          <span key={input.alias} className="mono">
            {input.alias}
            {input.label ? ` = ${input.label}` : ''}
          </span>
        ))}
      </div>
      <pre className="m-0 max-h-80 overflow-auto rounded-md border border-border bg-surface p-2 font-mono text-body text-fg">
        {cell.source}
      </pre>
      {output ? (
        <CodeCellOutputView output={output} stale={outputIsStale(cell)} />
      ) : (
        <p className="m-0 text-label text-fg-muted">
          {t('automation.codeCell.notRun')}
        </p>
      )}
    </div>
  )
}

interface VersionOption {
  id: string
  datasetId: string
  label: string
}

function useVersionOptions() {
  return useQuery({
    queryKey: ['code-cell', 'dataset-versions'],
    queryFn: async (): Promise<VersionOption[]> => {
      const versions = await client.list<{
        id: string
        dataset_id: string
        label: string
      }>(
        'dataset_versions',
        '?select=id,dataset_id,label&order=created_at.desc&limit=300',
      )
      if (versions.length === 0) return []
      const ids = [...new Set(versions.map((v) => v.dataset_id))]
      const datasets = await client.list<{ id: string; name: string }>(
        'datasets',
        `?select=id,name&id=in.(${ids.join(',')})`,
      )
      const names = new Map(datasets.map((d) => [d.id, d.name]))
      return versions.map((v) => ({
        id: v.id,
        datasetId: v.dataset_id,
        label: `${names.get(v.dataset_id) ?? '—'} · ${v.label}`,
      }))
    },
    staleTime: 60_000,
  })
}

type EditorBlock = Pick<NotebookBlock, 'id' | 'recordId' | 'payload'>

export function CodeCellBlockEditor({
  block,
  save,
  onStatusChange,
  readOnly,
}: {
  block: EditorBlock
  save: (
    payload: Record<string, unknown>,
  ) => Promise<SaveResult<Record<string, unknown>>>
  offline?: boolean
  onStatusChange?: (status: AutosaveStatus) => void
  readOnly?: boolean
}) {
  const initial = useMemo(() => payloadOf(block.payload), [block.payload])
  const [language, setLanguage] = useState<CodeCellLanguage>(
    isCodeCellLanguage(initial.language) ? initial.language : 'python',
  )
  const [source, setSource] = useState(initial.source ?? '')
  const [inputs, setInputs] = useState<CodeCellInput[]>(initial.inputs ?? [])
  const [output, setOutput] = useState<CodeCellOutput | null>(
    initial.output ?? null,
  )
  const [reproduction, setReproduction] = useState<CodeCellOutput | null>(null)
  const versions = useVersionOptions()
  const dirty = useRef(false)

  // The block changed underneath (another person, a conflict resolved).
  useEffect(() => {
    if (dirty.current) return
    setLanguage(isCodeCellLanguage(initial.language) ? initial.language : 'python')
    setSource(initial.source ?? '')
    setInputs(initial.inputs ?? [])
    setOutput(initial.output ?? null)
  }, [initial])

  const draft: CodeCellPayload = { language, source, inputs, output }
  const stale = outputIsStale(draft)

  async function persist(next: CodeCellPayload) {
    onStatusChange?.('saving')
    try {
      const result = await save({ ...next })
      dirty.current = !result.ok
      onStatusChange?.(result.ok ? 'clean' : 'failed')
      return result.ok
    } catch {
      onStatusChange?.('failed')
      return false
    }
  }

  const run = useMutation({
    mutationFn: async () => {
      await persist(draft)
      return requestCodeCellRun({
        action: 'run',
        recordId: block.recordId,
        blockId: block.id,
        language,
        source,
        inputs: inputs.map((i) => ({
          alias: i.alias,
          datasetVersionId: i.datasetVersionId,
        })),
      })
    },
    onSuccess: async (result) => {
      setOutput(result)
      setReproduction(null)
      await persist({ language, source, inputs, output: result })
    },
  })
  const reproduce = useMutation({
    mutationFn: () =>
      requestCodeCellRun({
        action: 'reproduce',
        recordId: block.recordId,
        runId: output?.runId,
      }),
    onSuccess: (result) => setReproduction(result),
  })

  function changeLanguage(next: CodeCellLanguage) {
    dirty.current = true
    setLanguage(next)
    const starterOther = starterSource(next === 'python' ? 'sql' : 'python')
    const nextSource =
      source.trim() === '' || source === starterOther ? starterSource(next) : source
    setSource(nextSource)
    void persist({ language: next, source: nextSource, inputs, output })
  }
  function changeInputs(next: CodeCellInput[]) {
    dirty.current = true
    setInputs(next)
    void persist({ language, source, inputs: next, output })
  }

  const taken = new Set(inputs.map((i) => i.datasetVersionId))
  const options = versions.data ?? []
  const canRun =
    !readOnly &&
    source.trim() !== '' &&
    inputs.every((i) => i.datasetVersionId !== '' && i.alias !== '')
  const error = run.error ?? reproduce.error

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        <Field label={t('automation.codeCell.language')}>
          <Select
            value={language}
            disabled={readOnly}
            onChange={(event) => {
              if (isCodeCellLanguage(event.target.value))
                changeLanguage(event.target.value)
            }}
          >
            {CODE_CELL_LANGUAGES.map((value) => (
              <option key={value} value={value}>
                {t(`automation.codeCell.languages.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('automation.codeCell.code')}
          hint={t(
            language === 'python'
              ? 'automation.codeCell.pythonHint'
              : 'automation.codeCell.sqlHint',
          )}
        >
          {language === 'sql' ? (
            <SqlEditor
              aria-label={t('automation.codeCell.codeAria')}
              value={source}
              rows={8}
              readOnly={readOnly}
              onChange={(event) => {
                dirty.current = true
                setSource(event.target.value)
              }}
              onBlur={() =>
                void persist({ language, source, inputs, output })
              }
            />
          ) : (
            <textarea
              aria-label={t('automation.codeCell.codeAria')}
              value={source}
              rows={10}
              readOnly={readOnly}
              spellCheck={false}
              placeholder={starterSource('python')}
              onChange={(event) => {
                dirty.current = true
                setSource(event.target.value)
              }}
              onBlur={() => void persist({ language, source, inputs, output })}
              className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            />
          )}
        </Field>
      </div>

      <Field
        label={t('automation.codeCell.inputs')}
        hint={t('automation.codeCell.inputsHint')}
      >
        <div className="flex flex-col gap-2">
          {inputs.length === 0 ? (
            <span className="text-label text-fg-muted">
              {t('automation.codeCell.noInputs')}
            </span>
          ) : null}
          {inputs.map((input, index) => (
            <div
              key={index}
              className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-2"
            >
              <Input
                aria-label={t('automation.codeCell.nameLabel')}
                value={input.alias}
                disabled={readOnly}
                onChange={(event) =>
                  setInputs((c) =>
                    c.map((x, i) =>
                      i === index ? { ...x, alias: event.target.value } : x,
                    ),
                  )
                }
                onBlur={() => void persist({ language, source, inputs, output })}
              />
              <Select
                aria-label={t('automation.codeCell.versionLabel')}
                value={input.datasetVersionId}
                disabled={readOnly}
                onChange={(event) => {
                  const chosen = options.find((o) => o.id === event.target.value)
                  changeInputs(
                    inputs.map((x, i) =>
                      i === index
                        ? {
                            ...x,
                            datasetVersionId: event.target.value,
                            datasetId: chosen?.datasetId,
                            label: chosen?.label,
                          }
                        : x,
                    ),
                  )
                }}
              >
                <option value="">{t('automation.codeCell.chooseVersion')}</option>
                {options
                  .filter((o) => o.id === input.datasetVersionId || !taken.has(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                {input.datasetVersionId &&
                !options.some((o) => o.id === input.datasetVersionId) ? (
                  <option value={input.datasetVersionId}>
                    {input.label ?? input.datasetVersionId}
                  </option>
                ) : null}
              </Select>
              {readOnly ? null : (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => changeInputs(inputs.filter((_, i) => i !== index))}
                >
                  {t('automation.codeCell.removeInput')}
                </Button>
              )}
            </div>
          ))}
          {!readOnly && inputs.length < MAX_CODE_CELL_INPUTS ? (
            <div>
              <Button
                size="sm"
                onClick={() =>
                  setInputs((c) => [
                    ...c,
                    {
                      alias: c.length === 0 ? 'samples' : `input${c.length + 1}`,
                      datasetVersionId: '',
                    },
                  ])
                }
              >
                {t('automation.codeCell.addInput')}
              </Button>
            </div>
          ) : null}
          {versions.isError ? (
            <span className="text-label text-danger-text">
              {t('automation.codeCell.versionsError')}
            </span>
          ) : null}
        </div>
      </Field>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!canRun || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending
              ? t('automation.codeCell.running')
              : output
                ? t('automation.codeCell.runAgain')
                : t('automation.codeCell.run')}
          </Button>
          {output && output.status === 'ok' && !stale ? (
            <Button
              size="sm"
              disabled={reproduce.isPending}
              onClick={() => reproduce.mutate()}
            >
              {reproduce.isPending
                ? t('automation.codeCell.reproducing')
                : t('automation.codeCell.reproduce')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <Notice tone="bad">
          {error instanceof Error && error.message
            ? error.message
            : t('automation.codeCell.couldNotRun')}
        </Notice>
      ) : null}
      {reproduction?.reproducedFrom ? (
        <Notice tone={reproduction.reproducedFrom.matches ? 'info' : 'warn'}>
          {t(
            reproduction.reproducedFrom.matches
              ? 'automation.codeCell.reproduced.same'
              : 'automation.codeCell.reproduced.different',
            { reference: reproduction.reference },
          )}
        </Notice>
      ) : null}
      {output ? (
        <CodeCellOutputView output={output} stale={stale} />
      ) : (
        <p className="m-0 text-label text-fg-muted">
          {t('automation.codeCell.notRun')}
        </p>
      )}
    </div>
  )
}
