import { useMemo, useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Muted } from '#/components/v3/ui/layout'
import { Select } from '#/components/v3/ui/select'
import type { PythonRuntimeInfo } from '#/components/v3/pipelines/pipelines-data'
import { parseDefault } from '#/lib/pipelines/authoring'
import type { PipelineInput, PipelineParameter } from '#/lib/pipelines/config'
import {
  PYTHON_COLUMN_TYPES,
  analysePython,
  isStarterStatement,
  normalisePackageName,
  parseRequirementsText,
  pythonSkeleton,
  requirementErrors,
  setContractInput,
  setContractOutput,
  unmetRequirements,
} from '#/lib/pipelines/python'
import type {
  PythonColumn,
  PythonColumnType,
  PythonContract,
  PythonTestRunFailure,
  PythonTestRunSuccess,
} from '#/lib/pipelines/python'
import { parseSample } from '#/lib/pipelines/sample'

/**
 * Authoring a Python step: the code with feedback while typing, the data contract
 * (the columns going in and the DataFrame coming out), the pipeline's pinned
 * packages, and a test run on sample rows.
 *
 * Python never runs in the browser. Feedback while typing is static (is there a
 * `transform`, is an import available in the pinned image); the test run sends the
 * code and a sample to the same isolated runner a pipeline run uses.
 */

const COLUMN_TYPE_LABELS: Record<PythonColumnType, string> = {
  text: t('data.pythonEditor.text'),
  integer: t('data.pythonEditor.integer'),
  decimal: t('data.pythonEditor.decimal'),
  boolean: t('data.pythonEditor.yesNo'),
  date: t('data.pythonEditor.date'),
  timestamp: t('data.pythonEditor.timestamp'),
  json: 'JSON',
}

/** One column list: a name, a type, whether a missing value is fine. */
export function ColumnsEditor({
  label,
  columns,
  onChange,
}: {
  /** Names the controls, e.g. “Output” or “readings”. */
  label: string
  columns: PythonColumn[]
  onChange: (columns: PythonColumn[]) => void
}) {
  const patch = (index: number, change: Partial<PythonColumn>) =>
    onChange(
      columns.map((column, position) =>
        position === index ? { ...column, ...change } : column,
      ),
    )
  return (
    <div className="flex flex-col gap-1.5">
      {columns.map((column, index) => {
        const n = index + 1
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              className="mono h-8 w-[170px] text-xs"
              aria-label={t('data.pythonEditor.ariaColumnName', { label, n })}
              value={column.name}
              onChange={(event) => patch(index, { name: event.target.value })}
            />
            <Select
              size="sm"
              aria-label={t('data.pythonEditor.ariaColumnType', { label, n })}
              value={column.type}
              onChange={(event) =>
                patch(index, { type: event.target.value as PythonColumnType })
              }
            >
              {PYTHON_COLUMN_TYPES.map((type) => (
                <option key={type} value={type}>
                  {COLUMN_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-label">
              <Checkbox
                aria-label={t('data.pythonEditor.ariaColumnCannotEmpty', {
                  label,
                  n,
                })}
                checked={column.nullable === false}
                onCheckedChange={(on) =>
                  patch(index, on ? { nullable: false } : { nullable: true })
                }
              />
              {t('data.pythonEditor.neverEmpty')}
            </label>
            <Button
              size="sm"
              variant="quiet"
              aria-label={t('data.pythonEditor.ariaRemoveColumn', { label, n })}
              onClick={() =>
                onChange(columns.filter((_, position) => position !== index))
              }
            >
              {t('common.actions.remove')}
            </Button>
          </div>
        )
      })}
      <div>
        <Button
          size="sm"
          icon="plus"
          aria-label={t('data.pythonEditor.ariaAddColumn', { label })}
          onClick={() => onChange([...columns, { name: '', type: 'text' }])}
        >
          {t('data.pythonEditor.addColumn')}
        </Button>
      </div>
    </div>
  )
}

/** The pipeline's pinned packages, checked against what the runtime provides. */
export function PythonPackagesEditor({
  requirements,
  onChange,
  runtime,
}: {
  requirements: string[]
  onChange: (requirements: string[]) => void
  runtime?: PythonRuntimeInfo
}) {
  // The textarea owns its text while it is being typed: a half-written line is
  // not a requirement yet, and parsing on every keystroke would eat it.
  const [text, setText] = useState(requirements.join('\n'))
  const [lastSent, setLastSent] = useState(requirements)
  if (requirements !== lastSent && requirements.join('\n') !== text) {
    setText(requirements.join('\n'))
    setLastSent(requirements)
  }
  const problems = [
    ...requirementErrors(requirements),
    ...(runtime?.packages
      ? unmetRequirements(requirements, runtime.packages)
      : []),
  ]
  const preinstalled = Object.entries(runtime?.packages ?? {}).filter(
    ([name]) =>
      !['pip', 'setuptools', 'wheel'].includes(normalisePackageName(name)),
  )
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label={t('data.pythonEditor.ariaPythonPackageRequirements')}
        value={text}
        rows={3}
        spellCheck={false}
        placeholder={t('data.pythonEditor.placeholderScipy1153')}
        onChange={(event) => {
          setText(event.target.value)
          const next = parseRequirementsText(event.target.value)
          setLastSent(next)
          onChange(next)
        }}
        className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      />
      <Muted className="text-label">
        {t('data.pythonEditor.onePerLinePinned')}
      </Muted>
      {problems.length ? (
        <Notice
          tone="bad"
          title={t('data.pythonEditor.thesePackagesCannotUsed')}
        >
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {runtime?.runtime ? (
        <Muted className="text-label">
          {t('data.pythonEditor.runtimeSdkCli')}
          <code>--runtime</code>
          {t('data.pythonEditor.pythonruntime')}{' '}
          <code
            className="num break-all"
            aria-label={t('data.pythonEditor.ariaPinnedPythonRuntime')}
          >
            {runtime.runtime}
          </code>
        </Muted>
      ) : null}
      {preinstalled.length ? (
        <details>
          <summary className="cursor-pointer text-label text-fg-muted">
            {t('data.pythonEditor.installedRuntime')}
            {runtime?.python
              ? t('data.pythonEditor.python', { python: runtime.python })
              : ''}{' '}
            — {preinstalled.length} packages
          </summary>
          <p className="num m-0 mt-1 text-caption text-fg-muted">
            {preinstalled
              .map(([name, version]) => `${name}==${version}`)
              .join('  ')}
          </p>
        </details>
      ) : null}
    </div>
  )
}

export interface PythonStepEditorProps {
  /** Names this step's controls: “Transform”, “Step 2”. */
  label: string
  statement: string
  onStatementChange: (statement: string) => void
  contract: PythonContract | undefined
  onContractChange: (contract: PythonContract | undefined) => void
  inputs: PipelineInput[]
  parameters: PipelineParameter[]
  /** Whether an earlier step's result arrives as `previous`. */
  hasPrevious: boolean
  runtime?: PythonRuntimeInfo
  /** The pipeline's pinned packages, sent along with a test run. */
  requirements?: string[]
  /** Hide the test run, e.g. where it cannot be used. */
  testable?: boolean
}

export function PythonStepEditor({
  label,
  statement,
  onStatementChange,
  contract,
  onContractChange,
  inputs,
  parameters,
  hasPrevious,
  runtime,
  requirements,
  testable = true,
}: PythonStepEditorProps) {
  const diagnostics = useMemo(
    () => analysePython(statement, { installed: runtime?.packages }),
    [statement, runtime?.packages],
  )
  const aliases = [
    ...inputs.map((input) => input.name).filter(Boolean),
    ...(hasPrevious ? ['previous'] : []),
  ]
  const outputColumns = contract?.output?.columns ?? []
  const declaredCount =
    outputColumns.length +
    Object.values(contract?.inputs ?? {}).reduce(
      (total, columns) => total + columns.length,
      0,
    )
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label={`${label} code`}
        value={statement}
        rows={10}
        spellCheck={false}
        onChange={(event) => onStatementChange(event.target.value)}
        className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      />
      <div className="flex flex-wrap items-center gap-2">
        {isStarterStatement(statement) ? (
          <Button
            size="sm"
            aria-label={t('data.pythonEditor.ariaStartFromDeclaredInputs', {
              label,
            })}
            onClick={() =>
              onStatementChange(
                pythonSkeleton({
                  inputs,
                  parameters,
                  hasPrevious,
                  contract,
                }),
              )
            }
          >
            {t('data.pythonEditor.startFromDeclaredInputs')}
          </Button>
        ) : null}
        <Muted className="text-label">
          {t('data.pythonEditor.eachInputListRow')}
        </Muted>
      </div>
      {diagnostics.length ? (
        <ul
          aria-label={`${label} checks`}
          className="m-0 flex list-none flex-col gap-0.5 p-0 text-label"
        >
          {diagnostics.map((diagnostic) => (
            <li
              key={`${diagnostic.line ?? 0}:${diagnostic.message}`}
              className={
                diagnostic.level === 'error'
                  ? 'text-danger-text'
                  : 'text-warning-text'
              }
            >
              {diagnostic.line
                ? t('data.pythonEditor.line', { line: diagnostic.line })
                : ''}
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary className="cursor-pointer text-label font-medium">
          {t('data.pythonEditor.dataContract')}{' '}
          <span className="font-normal text-fg-muted">
            {declaredCount
              ? t('data.pythonEditor.columnDeclared', {
                  declaredCount,
                  value: declaredCount === 1 ? '' : 's',
                })
              : t('data.pythonEditor.noneDeclared')}
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
          <Muted className="text-label">
            {t('data.pythonEditor.declareColumnsStepReads')}
          </Muted>
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium">
              {t('data.pythonEditor.returns')}
            </span>
            <ColumnsEditor
              label={`${label} output`}
              columns={outputColumns}
              onChange={(columns) =>
                onContractChange(
                  setContractOutput(
                    contract,
                    columns,
                    contract?.output?.additionalColumns,
                  ),
                )
              }
            />
            {outputColumns.length ? (
              <label className="flex items-center gap-2 text-label">
                <Checkbox
                  aria-label={t(
                    'data.pythonEditor.ariaAllowExtraOutputColumns',
                    { label },
                  )}
                  checked={Boolean(contract?.output?.additionalColumns)}
                  onCheckedChange={(on) =>
                    onContractChange(
                      setContractOutput(contract, outputColumns, Boolean(on)),
                    )
                  }
                />
                {t('data.pythonEditor.allowColumnsListed')}
              </label>
            ) : null}
          </div>
          {aliases.map((alias) => (
            <div key={alias} className="flex flex-col gap-1.5">
              <span className="text-label font-medium">
                {t('data.pythonEditor.reads')}{' '}
                <span className="mono">{alias}</span>
              </span>
              <ColumnsEditor
                label={`${label} input ${alias}`}
                columns={contract?.inputs?.[alias] ?? []}
                onChange={(columns) =>
                  onContractChange(setContractInput(contract, alias, columns))
                }
              />
            </div>
          ))}
        </div>
      </details>
      {testable ? (
        <details>
          <summary className="cursor-pointer text-label font-medium">
            {t('data.pythonEditor.testSampleData')}
          </summary>
          <PythonTestRun
            label={label}
            statement={statement}
            contract={contract}
            requirements={requirements}
            aliases={aliases}
            parameters={parameters}
            onUseOutputColumns={(columns) =>
              onContractChange(
                setContractOutput(
                  contract,
                  columns,
                  contract?.output?.additionalColumns,
                ),
              )
            }
          />
        </details>
      ) : null}
    </div>
  )
}

type TestOutcome =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'refused'; message: string }
  | { state: 'done'; result: PythonTestRunSuccess | PythonTestRunFailure }

function sampleHint(alias: string): string {
  return t('data.pythonEditor.pasteCsvHeaderRow', {
    // copy-ignore-next-line
    sample: `[{"${alias === 'previous' ? 'column' : 'value'}": 1}]`,
  })
}

/**
 * Run the step on rows the author pastes, without saving anything. The result is
 * what a run would produce (rows, the step's output, the environment) or, when it
 * fails, the message and the line; a passing run can offer its columns as the
 * step's output contract.
 */
export function PythonTestRun({
  label,
  statement,
  contract,
  requirements,
  aliases,
  parameters,
  onUseOutputColumns,
}: {
  label: string
  statement: string
  contract: PythonContract | undefined
  requirements?: string[]
  aliases: string[]
  parameters: PipelineParameter[]
  onUseOutputColumns: (columns: PythonColumn[]) => void
}) {
  const [samples, setSamples] = useState<Record<string, string>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [outcome, setOutcome] = useState<TestOutcome>({ state: 'idle' })

  const run = async () => {
    const inputs: Record<string, Array<Record<string, unknown>>> = {}
    for (const alias of aliases) {
      const parsed = parseSample(samples[alias] ?? '')
      if ('error' in parsed)
        return setOutcome({
          state: 'refused',
          message: `${alias}: ${parsed.error}`,
        })
      inputs[alias] = parsed.rows
    }
    const given: Record<string, unknown> = {}
    for (const parameter of parameters) {
      const text = values[parameter.name] ?? ''
      const value = text.trim()
        ? parseDefault(parameter.type, text)
        : parameter.default
      if (value === undefined) {
        if (parameter.required || text.trim())
          return setOutcome({
            state: 'refused',
            message: t('data.pythonEditor.giveValue', {
              name: parameter.name,
              type: parameter.type,
            }),
          })
        continue
      }
      given[parameter.name] = value
    }
    setOutcome({ state: 'running' })
    try {
      const response = await fetch('/api/pipelines/python-test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statement,
          inputs,
          parameters: given,
          ...(requirements?.length ? { requirements } : {}),
          ...(contract ? { contract } : {}),
        }),
      })
      const body = (await response.json().catch(() => null)) as
        PythonTestRunSuccess | PythonTestRunFailure | { error?: string } | null
      if (body && 'ok' in body) setOutcome({ state: 'done', result: body })
      else
        setOutcome({
          state: 'refused',
          message:
            (body && 'error' in body && body.error) ||
            t('data.pythonEditor.testRunCouldStarted'),
        })
    } catch {
      setOutcome({
        state: 'refused',
        message: t('data.pythonEditor.testRunCouldStarted2'),
      })
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-3 border-l-2 border-border pl-3">
      <Muted className="text-label">
        {t('data.pythonEditor.runsCodeSameIsolated')}
      </Muted>
      {aliases.length === 0 ? (
        <Muted className="text-label">
          {t('data.pythonEditor.stepDeclaresInputsSo')}
        </Muted>
      ) : null}
      {aliases.map((alias) => (
        <label key={alias} className="flex flex-col gap-1 text-label">
          <span className="font-medium">
            {t('data.pythonEditor.sampleFor')}{' '}
            <span className="mono">{alias}</span>
          </span>
          <textarea
            aria-label={t('data.pythonEditor.ariaSampleFor', { label, alias })}
            value={samples[alias] ?? ''}
            rows={4}
            spellCheck={false}
            placeholder={sampleHint(alias)}
            onChange={(event) =>
              setSamples((current) => ({
                ...current,
                [alias]: event.target.value,
              }))
            }
            className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          />
        </label>
      ))}
      {parameters.map((parameter) => (
        <label
          key={parameter.name}
          className="flex flex-wrap items-center gap-2 text-label"
        >
          <span className="mono w-[150px] truncate">{parameter.name}</span>
          <Input
            className="h-8 w-[200px] text-xs"
            aria-label={t('data.pythonEditor.ariaTestValue', {
              label,
              name: parameter.name,
            })}
            placeholder={
              parameter.default !== undefined
                ? String(parameter.default)
                : parameter.type
            }
            value={values[parameter.name] ?? ''}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [parameter.name]: event.target.value,
              }))
            }
          />
        </label>
      ))}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          aria-label={t('data.pythonEditor.ariaRunTest', { label })}
          disabled={outcome.state === 'running' || !statement.trim()}
          onClick={() => void run()}
        >
          {outcome.state === 'running'
            ? t('data.pythonEditor.running')
            : t('data.pythonEditor.runTest')}
        </Button>
      </div>
      <TestOutcomeView
        label={label}
        outcome={outcome}
        onUseOutputColumns={onUseOutputColumns}
      />
    </div>
  )
}

const PREVIEW_ROWS = 10

function TestOutcomeView({
  label,
  outcome,
  onUseOutputColumns,
}: {
  label: string
  outcome: TestOutcome
  onUseOutputColumns: (columns: PythonColumn[]) => void
}) {
  if (outcome.state === 'idle' || outcome.state === 'running') return null
  if (outcome.state === 'refused')
    return (
      <Notice tone="bad" title={t('data.pythonEditor.testRunDidStart')}>
        {outcome.message}
      </Notice>
    )
  const result = outcome.result
  const logs = result.logs.length ? (
    <CodeBlock
      code={result.logs.join('\n')}
      label={t('data.pythonEditor.testOutput', { label })}
      maxHeight="md"
    />
  ) : null
  if (!result.ok)
    return (
      <div className="flex flex-col gap-2">
        <Notice
          tone="bad"
          title={
            result.line
              ? t('data.pythonEditor.failedLine', { line: result.line })
              : t('data.pythonEditor.stepFailed')
          }
        >
          {result.error}
        </Notice>
        {logs}
      </div>
    )
  const columns = result.columns.map((column) => column.name)
  return (
    <div className="flex flex-col gap-2">
      <Notice tone="info" icon="check" role="status">
        {result.rowCount} {result.rowCount === 1 ? 'row' : 'rows'} in{' '}
        {result.durationMs} ms
        {result.environment
          ? t('data.pythonEditor.python2', {
              python: result.environment.python,
              join: Object.entries(result.environment.packages)
                .map(([name, version]) => ` · ${name} ${version}`)
                .join(''),
            })
          : ''}
      </Notice>
      {columns.length ? (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse text-caption">
            <thead>
              <tr className="bg-surface-muted text-left">
                {result.columns.map((column) => (
                  <th key={column.name} className="px-2 py-1 font-medium">
                    {column.name}{' '}
                    <span className="font-normal text-fg-muted">
                      {column.type}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                <tr key={index} className="border-t border-border-subtle">
                  {columns.map((name) => (
                    <td key={name} className="num px-2 py-1">
                      {cell(row[name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Muted>{t('data.pythonEditor.stepReturnedRows')}</Muted>
      )}
      {result.rowCount > PREVIEW_ROWS ? (
        <Muted className="text-caption">
          {t('data.pythonEditor.showingFirstRows', {
            PREVIEW_ROWS,
            rowCount: result.rowCount,
          })}
        </Muted>
      ) : null}
      {logs}
      {columns.length ? (
        <div>
          <Button
            size="sm"
            aria-label={t('data.pythonEditor.ariaUseResultOutputContract', {
              label,
            })}
            onClick={() => onUseOutputColumns(result.columns)}
          >
            {t('data.pythonEditor.useTheseColumnsOutput')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
