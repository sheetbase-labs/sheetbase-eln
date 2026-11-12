import { Link } from '@tanstack/react-router'
import { z } from 'zod'

import { t } from '#/copy'
import { useRef, useState } from 'react'
import { InputsEditor } from '#/components/pipelines/inputs-editor'
import { OutputEditor } from '#/components/pipelines/output-editor'
import type {
  OutputDraft,
  OutputMode,
} from '#/components/pipelines/output-editor'
import { ParametersEditor } from '#/components/pipelines/parameters-editor'
import { PythonPackagesEditor } from '#/components/pipelines/python-editor'
import { useSchedules } from '#/components/pipelines/pipelines-data'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'
import { readResultPreview } from '#/lib/pipelines/result-preview'
import { isNoCodeKind } from '#/lib/pipelines/no-code/forms'
import { MAX_STEPS } from '#/lib/pipelines/config'
import type {
  PipelineConfig,
  PipelineStep,
  PipelineStepKind,
} from '#/lib/pipelines/config'
import {
  convertToSql,
  freeStepName,
  duplicateStep,
  insertStep,
  moveStep,
  newStep,
  removeStep,
  updateStep,
} from '#/lib/pipelines/step-list'
import type { RunStepState } from '#/lib/pipelines/run-steps'
import { AddStepMenu } from './add-step-menu'
import { KIND_META, kindLabel, stepSummary } from './kinds'
import { StepDetail } from './step-detail'
import {
  BoardAdd,
  BoardBlock,
  BoardHead,
  BoardList,
  BoardStatus,
} from '#/features/pipelines/board/board'
import { StepMenu, StepRow, runStateStatus } from './step-row'
import { destinationName, useNotificationDestinations } from './step-bodies'
import { usePipelineEditor } from './use-pipeline-editor'

/** The Starts, the Inputs, every step in order, and the Output, as the board draws them. */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the list draws the Starts, the Inputs, every step and the Output against one selection and one draft.
// react-doctor-disable-next-line react-doctor/no-giant-component -- the list owns drag and drop, selection and every row kind; its rows are already split out.
export function StepList() {
  const editor = usePipelineEditor()
  const fileInput = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const { config, selected, setSelected, setConfig } = editor
  const destinations = useNotificationDestinations()
  const schedules = useSchedules(editor.pipelineId)

  if (!config) return null

  const draftVersion =
    editor.draft?.version ?? (editor.current ? editor.current.version + 1 : 1)

  const startsText = schedules.data?.length
    ? schedules.data
        .map((s) => scheduleSpecLabel(s.kind, s.spec, new Map()))
        .join(t('data.stepList.startsJoin'))
    : t('data.stepList.startsDefault')

  const destinationLabel = (id: string) => {
    const found = destinations.data?.find((d) => d.id === id)

    return found ? destinationName(found) : undefined
  }

  const select = (id: typeof selected) =>
    setSelected(selected === id ? null : id)

  const add = (kind: PipelineStepKind) => {
    const hasPrevious = config.steps.some(
      (s) => s.kind !== 'action' && s.kind !== 'notify' && s.kind !== 'ask',
    )

    // Notifications and actions run last; other steps go before them.
    const firstEffect = config.steps.findIndex(
      (s) => s.kind === 'action' || s.kind === 'notify',
    )

    const after =
      kind === 'action' || kind === 'notify' || firstEffect < 0
        ? config.steps.length - 1
        : firstEffect - 1

    const step = newStep(kind, config.steps, {
      inputs: config.inputs,
      parameters: config.parameters,
      hasPrevious,
      askedUserIds: Object.keys(editor.members).slice(0, 1),
    })

    setConfig((c) => ({ ...c, steps: insertStep(c.steps, step, after) }))
    setSelected(`step:${step.name}`)
  }

  // A .py or .sql file becomes a step; a notebook becomes a Python step from its code cells.
  const takeFile = async (file: File) => {
    setDropError(null)
    const text = await file.text()
    const lower = file.name.toLowerCase()
    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase()

    const made = fileStep(lower, text, base, config.steps)

    if (!made) {
      setDropError(t('data.stepList.dropRefused', { name: file.name }))

      return
    }

    setConfig((c) => ({
      ...c,
      steps: insertStep(c.steps, made, lastDataIndex(c.steps)),
    }))
    setSelected(`step:${made.name}`)
  }

  const outputDraft: OutputDraft = {
    mode: config.output.mode,
    datasetName: config.output.datasetName ?? '',
    schemaVersionId: config.output.schemaVersionId ?? '',
    datasetId: config.output.datasetId ?? '',
    datasetLabel: config.output.datasetLabel,
    fieldMapping: config.output.fieldMapping ?? null,
  }

  const trialPreview = editor.trialResult?.report.ok
    ? editor.trialResult.report.preview
    : undefined

  const stepFacts = (name: string) => editor.facts.trial[name] ?? undefined

  const outputErrors: Record<string, string> = {}

  for (const error of editor.errors)
    if (error.field.startsWith('output.'))
      outputErrors[error.field.slice('output.'.length)] ??= error.message

  const lastResultColumns =
    readResultPreview(editor.latestRun?.result)?.columns ?? []

  return (
    <div className="pb-col">
      <BoardList>
        <BoardHead
          kind={t('data.stepList.headKind')}
          step={t('data.stepList.headStep')}
          rows={
            editor.trialResult
              ? t('data.stepList.headTry')
              : t('data.stepList.headLastTry')
          }
          state={
            editor.latestRunNumber
              ? t('data.stepList.headRun', { n: editor.latestRunNumber })
              : t('data.stepList.headRunNone')
          }
        />

        <BoardBlock ends>
          <StepRow
            icon="clock"
            kind={t('data.stepList.kindStarts')}
            summary={startsText}
            label={t('data.stepList.startsAria')}
            status={
              <Link
                to="/pipelines/$pipelineId/triggers"
                params={{ pipelineId: editor.pipelineId }}
                className="text-label text-link"
              >
                {t('common.actions.edit')}
              </Link>
            }
          />
        </BoardBlock>

        <BoardBlock selected={selected === 'inputs'}>
          <StepRow
            icon="database"
            kind={t('data.stepList.kindInputs')}
            summary={
              config.inputs.length
                ? config.inputs.map((i) => i.name).join(', ')
                : t('data.stepList.inputsNone')
            }
            rows={config.inputs
              .map((i) => editor.facts.trial[i.name]?.rows)
              .filter((n) => n !== undefined)
              .join(' · ')}
            expanded={selected === 'inputs'}
            label={t('data.stepList.inputsAria')}
            onSelect={() => select('inputs')}
          />
          {selected === 'inputs' ? (
            <div className="flex flex-col gap-4 px-3 pb-3 pl-10">
              <InputsEditor
                inputs={config.inputs}
                onChange={(inputs) => setConfig((c) => ({ ...c, inputs }))}
                onInsert={() => undefined}
              />
              <details className="text-body">
                <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                  {t('data.pipelineSteps.runParameters', {
                    length: config.parameters.length,
                  })}
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  <p className="m-0 text-label text-fg-muted">
                    {t('data.pipelineSteps.optionalValuesSuppliedWhen')}
                  </p>
                  <ParametersEditor
                    parameters={config.parameters}
                    onChange={(parameters) =>
                      setConfig((c) => ({ ...c, parameters }))
                    }
                  />
                </div>
              </details>
              {editor.usesPython ? (
                <details className="text-body">
                  <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                    {t('data.pipelineSteps.pythonPackages', {
                      length: config.pythonRequirements?.length ?? 0,
                    })}
                  </summary>
                  <div className="mt-3">
                    <PythonPackagesEditor
                      requirements={config.pythonRequirements ?? []}
                      runtime={editor.runtime.data}
                      onChange={(requirements) =>
                        setConfig((c) => ({
                          ...c,
                          pythonRequirements: requirements,
                        }))
                      }
                    />
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </BoardBlock>

        {config.steps.map((step, index) => {
          const id = `step:${step.name}` as const
          const open = selected === id
          const problems = editor.problemsOf(index)

          // A form step already says why its SQL can't be written.
          const listProblems = isNoCodeKind(step.kind)
            ? problems.filter((p) => !p.field.endsWith('.form'))
            : problems

          const facts = stepFacts(step.name)
          const runState = editor.runStates[step.name]

          const state: RunStepState | 'new' | undefined =
            editor.latestRun && !runState ? 'new' : runState

          const shown = runStateStatus(
            state,
            editor.draft?.version ?? draftVersion,
          )

          const warn = Boolean(
            facts?.rows !== undefined &&
            step.kind === 'check_ranges' &&
            facts.rows > 0,
          )

          return (
            <BoardBlock key={step.name} selected={open}>
              <StepRow
                icon={KIND_META[step.kind].icon}
                kind={kindLabel(step)}
                summary={stepSummary(step, {
                  members: editor.members,
                  destinationName: destinationLabel,
                })}
                detail={
                  'onlyIfRows' in step && step.onlyIfRows
                    ? t('data.stepList.skippedWhenNoRows')
                    : undefined
                }
                rows={
                  facts?.rows === undefined
                    ? undefined
                    : t('data.stepList.rowCount', {
                        count: facts.rows,
                      })
                }
                rowsWarn={warn}
                status={
                  <BoardStatus tone={shown.tone}>{shown.label}</BoardStatus>
                }
                expanded={open}
                problem={problems.at(0)?.message}
                label={t('data.stepList.stepAria', {
                  n: index + 1,
                  name: step.name,
                })}
                onSelect={() => select(id)}
                menu={
                  <StepMenu
                    label={t('data.stepList.moreForStep', { n: index + 1 })}
                    index={index}
                    count={config.steps.length}
                    convertible={isNoCodeKind(step.kind)}
                    onMove={(by) =>
                      setConfig((c) => ({
                        ...c,
                        steps: moveStep(c.steps, index, by),
                      }))
                    }
                    onDuplicate={() =>
                      setConfig((c) => ({
                        ...c,
                        steps: duplicateStep(c.steps, index),
                      }))
                    }
                    onRemove={() => {
                      setConfig((c) => ({
                        ...c,
                        steps: removeStep(c.steps, index),
                      }))
                      setSelected(null)
                    }}
                    onConvert={() =>
                      setConfig((c) => ({
                        ...c,
                        steps: convertToSql(c.steps, index),
                      }))
                    }
                  />
                }
              />
              {open ? (
                <>
                  <StepDetail
                    config={config}
                    index={index}
                    workspaceId={editor.workspaceId}
                    members={editor.members}
                    runtime={editor.runtime.data}
                    facts={{ ...editor.facts.run, ...editor.facts.trial }}
                    onChange={(next: PipelineStep) => {
                      setConfig((c) => ({
                        ...c,
                        steps: updateStep(c.steps, index, next),
                      }))

                      if (next.name !== step.name)
                        setSelected(`step:${next.name}`)
                    }}
                    onConvertToSql={() =>
                      setConfig((c) => ({
                        ...c,
                        steps: convertToSql(c.steps, index),
                      }))
                    }
                  />
                  {listProblems.length ? (
                    <ul className="m-0 flex list-none flex-col gap-0.5 px-3 pb-3 pl-10 text-label text-danger-text">
                      {listProblems.map((p) => (
                        <li key={`${p.field}:${p.message}`}>{p.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </BoardBlock>
          )
        })}

        <BoardAdd
          className={dropping ? 'bg-selection-subtle' : undefined}
          onDragOver={(event) => {
            event.preventDefault()
            setDropping(true)
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDropping(false)
            const file = event.dataTransfer.files.item(0)

            if (file) void takeFile(file)
          }}
        >
          <AddStepMenu count={config.steps.length} onAdd={add} />
          <span className="text-label text-fg-muted">
            {t('data.stepList.addHint')}
          </span>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-label text-link underline focus-visible:outline-2 focus-visible:outline-focus"
            onClick={() => fileInput.current?.click()}
          >
            {t('data.stepList.chooseFile')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".py,.sql,.ipynb"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('data.stepList.dropFileAria')}
            onChange={(event) => {
              const file = event.target.files?.item(0)

              if (file) void takeFile(file)
              event.target.value = ''
            }}
          />
          {dropError ? (
            <span className="w-full text-label text-danger-text" role="alert">
              {dropError}
            </span>
          ) : null}
        </BoardAdd>

        <BoardBlock ends selected={selected === 'output'}>
          <StepRow
            icon="download"
            kind={t('data.stepList.kindOutput')}
            summary={outputSummary(config.output)}
            rows={
              trialPreview
                ? t('data.stepList.keptRows', {
                    count: trialPreview.rowCount,
                  })
                : undefined
            }
            status={
              <BoardStatus tone="none">
                {t('data.stepList.stateNotYet')}
              </BoardStatus>
            }
            expanded={selected === 'output'}
            label={t('data.stepList.outputAria')}
            onSelect={() => select('output')}
          />
          {selected === 'output' ? (
            <div className="px-3 pb-3 pl-10">
              <p className="mb-2 mt-0 text-label text-fg-muted">
                {t('data.pipelineSteps.chooseWhetherRealRun')}
              </p>
              <OutputEditor
                value={outputDraft}
                resultColumns={lastResultColumns}
                fieldErrors={outputErrors}
                onChange={(patch) =>
                  setConfig((c) =>
                    nextOutput(c, patch, editor.definition.data?.name ?? ''),
                  )
                }
              />
            </div>
          ) : null}
        </BoardBlock>
      </BoardList>
      {config.moreOutputs?.length ? (
        <p className="m-0 px-3 pb-2 text-label text-fg-muted">
          {t('data.stepList.moreOutputsInFile', {
            count: config.moreOutputs.length,
          })}
        </p>
      ) : null}
      {config.include?.length ? (
        <p className="m-0 px-3 pb-2 text-label text-fg-muted">
          {t('data.stepList.includesInFile', {
            sets: config.include.map((entry) => entry.set).join(', '),
          })}
        </p>
      ) : null}
      <p className="pb-foot m-0">
        {t('data.stepList.listFoot', { max: MAX_STEPS })}
      </p>
    </div>
  )
}

/** After the last step that gives rows or pauses, before any action or notification. */
function lastDataIndex(steps: PipelineStep[]): number {
  const firstEffect = steps.findIndex(
    (s) => s.kind === 'action' || s.kind === 'notify',
  )

  return firstEffect < 0 ? steps.length - 1 : firstEffect - 1
}

function fileStep(
  lowerName: string,
  text: string,
  base: string,
  steps: PipelineStep[],
): PipelineStep | null {
  const name = freeStepName(
    /^[a-z]/.test(base) ? base.replace(/[^a-z0-9]+/g, '_') : 'step',
    steps,
  )

  if (lowerName.endsWith('.sql'))
    return { name, kind: 'sql', statement: text.trim() }

  if (lowerName.endsWith('.py'))
    return { name, kind: 'python', statement: text }

  if (lowerName.endsWith('.ipynb')) {
    const code = notebookCode(text)

    return code ? { name, kind: 'python', statement: code } : null
  }

  return null
}

/** The code cells of a notebook, in order, without notebook magics. */
function notebookCode(json: string): string | null {
  const parsed = z
    .object({
      cells: z.array(
        z.object({
          cell_type: z.string(),
          source: z.union([z.string(), z.array(z.string())]),
        }),
      ),
    })
    .safeParse(safeJson(json))

  if (!parsed.success) return null

  return `${parsed.data.cells
    .filter((cell) => cell.cell_type === 'code')
    .map((cell) =>
      (Array.isArray(cell.source) ? cell.source.join('') : cell.source)
        .split('\n')
        .filter((line) => !/^\s*[%!]/.test(line))
        .join('\n'),
    )
    .join('\n\n')}\n`
}

function safeJson(text: string): z.core.util.JSONType | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function outputSummary(output: {
  mode: OutputMode
  datasetName?: string
  datasetLabel: string
}): string {
  if (output.mode === 'none') return t('data.stepList.outputNone')

  if (output.mode === 'append')
    return t('data.stepList.outputAppend', { label: output.datasetLabel })

  return t('data.stepList.outputCreate', {
    name: output.datasetName || output.datasetLabel,
  })
}

function nextOutput(
  config: PipelineConfig,
  patch: Partial<OutputDraft>,
  pipelineName: string,
): PipelineConfig {
  const output = { ...config.output }

  if (patch.mode !== undefined) {
    output.mode = patch.mode

    // A new dataset starts with the pipeline's own name and a label to match.
    if (patch.mode !== 'none' && !output.datasetLabel.trim())
      output.datasetLabel = pipelineName

    if (patch.mode === 'create' && !output.datasetName?.trim())
      output.datasetName = pipelineName

    if (patch.mode === 'none') output.fieldMapping = undefined
  }

  if (patch.datasetName !== undefined) output.datasetName = patch.datasetName

  if (patch.schemaVersionId !== undefined)
    output.schemaVersionId = patch.schemaVersionId || undefined

  if (patch.datasetId !== undefined)
    output.datasetId = patch.datasetId || undefined

  if (patch.datasetLabel !== undefined) output.datasetLabel = patch.datasetLabel

  if (patch.fieldMapping !== undefined) output.fieldMapping = patch.fieldMapping

  return { ...config, output }
}
