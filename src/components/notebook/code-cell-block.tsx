/**
 * Code cell block: Python or SQL on dataset versions, run in the pipeline
 * sandbox. The output is kept in the block with the code, the inputs' digests
 * and the image it ran in, so a signed notebook shows exactly what was run, and
 * a run can be run again to see whether it comes out the same.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

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
  CodeCellLanguage,
  CodeCellOutput,
  CodeCellPayload,
} from '#/lib/code-cells/code-cell'
import { notebookDataClient, formatRelativeTime } from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { AutosaveStatus, SaveResult } from './use-autosave'
import { readOnlyEntries } from './read-only-entries'

const client = notebookDataClient
const PREVIEW_ROWS = 10

const codeCellOutputSchema = z.looseObject({
  runId: z.string(),
  reference: z.string(),
  status: z.enum(['ok', 'error']),
  ranAt: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.json())),
  rowCount: z.number(),
  truncated: z.boolean(),
  errorMessage: z.string().nullable().optional(),
  logs: z.array(z.string()).optional(),
  source: z.string(),
  language: z.enum(CODE_CELL_LANGUAGES),
  sourceDigest: z.string(),
  outputDigest: z.string().nullable(),
  runtime: z.string().nullable(),
  inputs: z.array(
    z.looseObject({
      alias: z.string(),
      datasetVersionId: z.string(),
      label: z.string(),
      rowCount: z.number(),
      digest: z.string(),
    }),
  ),
  reproducedFrom: z
    .looseObject({
      runId: z.string(),
      reference: z.string(),
      matches: z.boolean(),
    })
    .nullable()
    .optional(),
}) satisfies z.ZodType<CodeCellOutput>

const codeCellPayloadSchema = z.looseObject({
  language: z.enum(CODE_CELL_LANGUAGES).optional(),
  source: z.string().optional(),
  inputs: z
    .array(
      z.looseObject({
        alias: z.string(),
        datasetVersionId: z.string(),
        datasetId: z.string().optional(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  output: codeCellOutputSchema.nullable().optional(),
}) satisfies z.ZodType<CodeCellPayload>

const payloadOf = codeCellPayloadSchema.parse.bind(codeCellPayloadSchema)

function shortDigest(digest: string | null | undefined): string {
  if (!digest) return '—'
  const [algorithm, hex] = digest.split(':')

  return hex ? `${algorithm}:${hex.slice(0, 12)}…` : digest.slice(0, 20)
}

function cellText(
  value: z.infer<ReturnType<typeof z.json>> | undefined,
): string {
  if (value === null || value === undefined) return ''

  const scalar = z.union([z.string(), z.number(), z.boolean()]).safeParse(value)

  return scalar.success ? String(scalar.data) : JSON.stringify(value)
}

/** The output of a run: the first rows, and what was kept with it. */
function CodeCellOutputView({
  output,
  stale,
}: {
  output: CodeCellOutput
  stale: boolean
}) {
  const shown = codeCellOutputSchema.parse(output).rows.slice(0, PREVIEW_ROWS)

  return (
    <div
      className="flex flex-col gap-2"
      aria-label={t('automation.codeCell.outputLabel')}
    >
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
      {stale ? (
        <Notice tone="warn">{t('automation.codeCell.stale')}</Notice>
      ) : null}
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
                {readOnlyEntries(shown, (row) => JSON.stringify(row)).map(
                  ({ key, value: row }) => (
                    <TableRow key={key}>
                      {output.columns.map((column) => (
                        <TableCell key={column} className="truncate">
                          {cellText(row[column])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ),
                )}
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
        <FragmentRow
          key={input.alias}
          label={t('automation.codeCell.provenance.input', {
            alias: input.alias,
          })}
        >
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

interface CodeCellEditorProps {
  block: EditorBlock
  save: (
    payload: NotebookBlock['payload'],
  ) => Promise<SaveResult<NotebookBlock['payload']>>
  offline?: boolean
  onStatusChange?: (status: AutosaveStatus) => void
  readOnly?: boolean
}

/** Owns the local draft, its input identities, persistence and run/reproduction results. */
function useCodeCellDraft({
  block,
  save,
  onStatusChange,
}: CodeCellEditorProps) {
  const initial = useMemo(() => payloadOf(block.payload), [block.payload])

  const [language, setLanguage] = useState<CodeCellLanguage>(
    isCodeCellLanguage(initial.language) ? initial.language : 'python',
  )

  const [source, setSource] = useState(initial.source ?? '')
  const editorId = useId()

  const [inputRows, setInputRows] = useState(() =>
    (initial.inputs ?? []).map((input, index) => ({
      key: `${editorId}-${index}`,
      input,
    })),
  )

  const inputs = inputRows.map((row) => row.input)

  const [output, setOutput] = useState<CodeCellOutput | null>(
    initial.output ?? null,
  )

  const [reproduction, setReproduction] = useState<CodeCellOutput | null>(null)
  const dirty = useRef(false)

  // The block changed underneath (another person, a conflict resolved).
  useEffect(() => {
    if (dirty.current) return
    setLanguage(
      isCodeCellLanguage(initial.language) ? initial.language : 'python',
    )
    setSource(initial.source ?? '')
    setInputRows(
      (initial.inputs ?? []).map((input) => ({
        key: crypto.randomUUID(),
        input,
      })),
    )
    setOutput(initial.output ?? null)
  }, [initial])

  const draft = { language, source, inputs, output } satisfies CodeCellPayload

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

  // Reproduction is consumed only by local reproduction state; no run query cache exists.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
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
      source.trim() === '' || source === starterOther
        ? starterSource(next)
        : source

    setSource(nextSource)
    void persist({ language: next, source: nextSource, inputs, output })
  }

  function changeInputs(rows: typeof inputRows) {
    const next = rows.map((row) => row.input)
    dirty.current = true
    setInputRows(rows)
    void persist({ language, source, inputs: next, output })
  }

  function changeSource(value: string) {
    dirty.current = true
    setSource(value)
  }

  function changeAlias(key: string, alias: string) {
    dirty.current = true
    setInputRows((rows) =>
      rows.map((row) =>
        row.key === key ? { ...row, input: { ...row.input, alias } } : row,
      ),
    )
  }

  function addInput() {
    dirty.current = true
    const key = crypto.randomUUID()
    setInputRows((rows) => [
      ...rows,
      {
        key,
        input: {
          alias: rows.length === 0 ? 'samples' : `input${rows.length + 1}`,
          datasetVersionId: '',
        },
      },
    ])
  }

  return {
    draft,
    inputRows,
    reproduction,
    run,
    reproduce,
    changeLanguage,
    changeInputs,
    changeSource,
    changeAlias,
    addInput,
    persist,
  }
}

export function CodeCellBlockEditor(props: CodeCellEditorProps) {
  const { readOnly } = props

  const {
    draft,
    inputRows,
    reproduction,
    run,
    reproduce,
    changeLanguage,
    changeInputs,
    changeSource,
    changeAlias,
    addInput,
    persist,
  } = useCodeCellDraft(props)

  const { language, source, inputs, output } = draft
  const stale = outputIsStale(draft)

  const canRun =
    !readOnly &&
    source.trim() !== '' &&
    inputs.every((i) => i.datasetVersionId !== '' && i.alias !== '')

  const error = run.error ?? reproduce.error

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <CodeCellSource
        language={language}
        source={source}
        readOnly={readOnly}
        onLanguageChange={changeLanguage}
        onSourceChange={changeSource}
        onBlur={() => void persist({ language, source, inputs, output })}
      />

      <CodeCellInputs
        inputRows={inputRows}
        readOnly={readOnly}
        onChange={changeInputs}
        onAliasChange={changeAlias}
        onAdd={addInput}
        onBlur={() => void persist(draft)}
      />

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
      <CodeCellResults
        error={error}
        reproduction={reproduction}
        output={output}
        stale={stale}
      />
    </div>
  )
}

/** Language and source editing share the same save-on-blur contract. */
function CodeCellSource({
  language,
  source,
  readOnly,
  onLanguageChange,
  onSourceChange,
  onBlur,
}: {
  language: CodeCellLanguage
  source: string
  readOnly?: boolean
  onLanguageChange: (language: CodeCellLanguage) => void
  onSourceChange: (source: string) => void
  onBlur: () => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
      <Field label={t('automation.codeCell.language')}>
        <Select
          value={language}
          disabled={readOnly}
          onChange={(event) => {
            if (isCodeCellLanguage(event.target.value))
              onLanguageChange(event.target.value)
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
            onChange={(event) => onSourceChange(event.target.value)}
            onBlur={onBlur}
          />
        ) : (
          <textarea
            aria-label={t('automation.codeCell.codeAria')}
            value={source}
            rows={10}
            readOnly={readOnly}
            spellCheck={false}
            placeholder={starterSource('python')}
            onChange={(event) => onSourceChange(event.target.value)}
            onBlur={onBlur}
            className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          />
        )}
      </Field>
    </div>
  )
}

/** Presents saved run evidence and its separate reproduction comparison without changing either. */
function CodeCellResults({
  error,
  reproduction,
  output,
  stale,
}: {
  error: Error | null
  reproduction: CodeCellOutput | null
  output: CodeCellOutput | null
  stale: boolean
}) {
  return (
    <>
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
    </>
  )
}

/** Version choices belong to the input list; editor-local keys never enter the saved payload. */
function CodeCellInputs({
  inputRows,
  readOnly,
  onChange,
  onAliasChange,
  onAdd,
  onBlur,
}: {
  inputRows: ReturnType<typeof useCodeCellDraft>['inputRows']
  readOnly?: boolean
  onChange: ReturnType<typeof useCodeCellDraft>['changeInputs']
  onAliasChange: ReturnType<typeof useCodeCellDraft>['changeAlias']
  onAdd: () => void
  onBlur: () => void
}) {
  const versions = useVersionOptions()
  const taken = new Set(inputRows.map(({ input }) => input.datasetVersionId))
  const options = versions.data ?? []

  return (
    <Field
      label={t('automation.codeCell.inputs')}
      hint={t('automation.codeCell.inputsHint')}
    >
      <div className="flex flex-col gap-2">
        {inputRows.length === 0 ? (
          <span className="text-label text-fg-muted">
            {t('automation.codeCell.noInputs')}
          </span>
        ) : null}
        {inputRows.map(({ input, key }) => (
          <div
            key={key}
            className="grid grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-2"
          >
            <Input
              aria-label={t('automation.codeCell.nameLabel')}
              value={input.alias}
              disabled={readOnly}
              onChange={(event) => onAliasChange(key, event.target.value)}
              onBlur={onBlur}
            />
            <Select
              aria-label={t('automation.codeCell.versionLabel')}
              value={input.datasetVersionId}
              disabled={readOnly}
              onChange={(event) => {
                const chosen = options.find((o) => o.id === event.target.value)

                onChange(
                  inputRows.map((row) =>
                    row.key === key
                      ? {
                          ...row,
                          input: {
                            ...row.input,
                            datasetVersionId: event.target.value,
                            datasetId: chosen?.datasetId,
                            label: chosen?.label,
                          },
                        }
                      : row,
                  ),
                )
              }}
            >
              <option value="">{t('automation.codeCell.chooseVersion')}</option>
              {options
                .filter(
                  (o) => o.id === input.datasetVersionId || !taken.has(o.id),
                )
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
                onClick={() =>
                  onChange(inputRows.filter((row) => row.key !== key))
                }
              >
                {t('automation.codeCell.removeInput')}
              </Button>
            )}
          </div>
        ))}
        {!readOnly && inputRows.length < MAX_CODE_CELL_INPUTS ? (
          <div>
            <Button size="sm" onClick={onAdd}>
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
  )
}
