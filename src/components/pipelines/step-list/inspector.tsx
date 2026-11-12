import { useState } from 'react'

import { t } from '#/copy'
import {
  BoardButton,
  BoardInput,
  BoardIo,
} from '#/features/pipelines/board/board'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '#/components/ui/dialog'
import { Inspector } from '#/components/ui/layout'
import { Icon } from '#/components/icons'
import { TrialPanel } from '#/components/pipelines/trial-panel'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { isNoCodeKind } from '#/lib/pipelines/no-code/forms'
import {
  noCodeColumnsUsed,
  noCodeColumnsWritten,
} from '#/lib/pipelines/no-code/summary'
import type { PipelineStep } from '#/lib/pipelines/config'
import { isDataStep, previousDataStep } from '#/lib/pipelines/step-list'
import { MAX_EXECUTION_SECONDS } from '#/lib/pipelines/statement'
import { KIND_META, kindLabel } from './kinds'
import { usePipelineEditor } from './use-pipeline-editor'

const MODE_LABEL: Record<PipelineStep['kind'], string> = {
  filter: t('data.stepList.modeForm'),
  join: t('data.stepList.modeForm'),
  calculate: t('data.stepList.modeForm'),
  check_ranges: t('data.stepList.modeForm'),
  flag: t('data.stepList.modeForm'),
  sql: t('data.stepList.modeSql'),
  python: t('data.stepList.modePython'),
  plugin: t('data.stepList.modePlugin'),
  ask: t('data.stepList.modeAsk'),
  action: t('data.stepList.modeAction'),
  notify: t('data.stepList.modeNotify'),
}

function InspectorSection({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <section>
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  )
}

/** Settings for the selected step: what it reads and writes, what happens if it fails, what the last try showed. */
export function StepInspector() {
  const editor = usePipelineEditor()
  const { config, selected } = editor

  if (!config) return null

  const index =
    selected?.startsWith('step:') === true
      ? config.steps.findIndex((s) => `step:${s.name}` === selected)
      : -1

  const step = index >= 0 ? config.steps[index] : undefined

  return (
    <Inspector
      label={t('data.stepList.inspectorLabel')}
      width={300}
      className="pb-scope gap-5"
    >
      {step ? <SelectedStep step={step} index={index} /> : null}
      <TryResult />
      <DraftSection />
    </Inspector>
  )
}

// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the panel answers what a step reads, writes and does from one set of facts; splitting it would pass the same facts through several files.
function SelectedStep({ step, index }: { step: PipelineStep; index: number }) {
  const editor = usePipelineEditor()
  const { config, setConfig } = editor

  if (!config) return null
  const before = previousDataStep(config.steps, index)
  const data = isDataStep(step)
  const trial = editor.facts.trial
  const run = editor.facts.run

  const rowsIn = before
    ? (trial[before.name] ?? run[before.name])?.rows
    : undefined

  const rowsOut = (trial[step.name] ?? run[step.name])?.rows

  const columnsBefore = before
    ? (trial[before.name] ?? run[before.name])?.columns
    : undefined

  const used =
    isNoCodeKind(step.kind) && 'form' in step
      ? noCodeColumnsUsed(step.kind, step.form)
      : []

  const written =
    isNoCodeKind(step.kind) && 'form' in step
      ? noCodeColumnsWritten(step.kind, step.form)
      : []

  const next = config.steps.slice(index + 1).find((s) => isDataStep(s))

  return (
    <>
      <InspectorSection>
        <div className="mb-2.5 flex items-center gap-2">
          <span className="kind">{kindLabel(step)}</span>
          <h3 className="m-0 min-w-0 flex-1 truncate text-[13px]">
            {t('data.stepList.inspectorTitle', {
              n: index + 1,
              name: step.name,
            })}
          </h3>
        </div>
        <dl className="dl">
          <dt>{t('data.stepList.settingMode')}</dt>
          <dd>{MODE_LABEL[step.kind]}</dd>
          <dt>{t('data.stepList.settingIfFails')}</dt>
          <dd>{t('data.stepList.ifFailsStop')}</dd>
          {data ? (
            <>
              <dt>{t('data.stepList.settingTimeLimit')}</dt>
              <dd className="num">
                {t('data.stepList.seconds', { count: MAX_EXECUTION_SECONDS })}
              </dd>
            </>
          ) : null}
        </dl>
        {data ? (
          <label className="check mt-3">
            <input
              type="checkbox"
              checked={Boolean(step.onlyIfRows)}
              onChange={(e) => {
                const on = e.target.checked

                setConfig((c) => ({
                  ...c,
                  steps: c.steps.map((s, i) => {
                    if (i !== index || !isDataStep(s)) return s

                    if (on) return { ...s, onlyIfRows: true }
                    const { onlyIfRows: _o, ...rest } = s

                    return rest
                  }),
                }))
              }}
            />
            <span>
              {t('data.stepList.onlyIfRows')}
              <div className="muted mt-0.5">
                {t('data.stepList.onlyIfRowsHint')}
              </div>
            </span>
          </label>
        ) : null}
      </InspectorSection>

      {data ? (
        <InspectorSection title={t('data.stepList.readsAndWrites')}>
          <BoardIo
            rows={[
              {
                label: t('data.stepList.ioReads'),
                value: before ? (
                  <>
                    <span className="ref mono text-[11px]">previous</span>{' '}
                    {t('data.stepList.ioPrevious', { name: before.name })}
                  </>
                ) : (
                  t('data.stepList.ioInputs')
                ),
                count:
                  rowsIn === undefined
                    ? undefined
                    : t('data.stepList.rowCount', { count: rowsIn }),
              },
              ...(used.length
                ? [
                    {
                      label: t('data.stepList.ioUses'),
                      value: (
                        <span className="mono text-[11px]">
                          {used.join(', ')}
                        </span>
                      ),
                      count: columnsBefore
                        ? t('data.stepList.ioOf', {
                            used: used.length,
                            all: columnsBefore.length,
                          })
                        : undefined,
                    },
                  ]
                : []),
              {
                label: t('data.stepList.ioWrites'),
                mine: true,
                value: written.length
                  ? t('data.stepList.ioNewColumns', {
                      names: written.join(', '),
                    })
                  : t('data.stepList.ioRowsOnly'),
                count:
                  rowsOut === undefined
                    ? undefined
                    : t('data.stepList.rowCount', { count: rowsOut }),
              },
              {
                label: t('data.stepList.ioNext'),
                value: next
                  ? t('data.stepList.ioNextStep', {
                      name: next.name,
                      kind: KIND_META[next.kind].label,
                    })
                  : t('data.stepList.ioOutput'),
              },
            ]}
          />
        </InspectorSection>
      ) : null}

      <InspectorSection title={t('data.stepList.temporaryOrKept')}>
        <div className="mb-2 flex items-center gap-2 text-label">
          <span className="tmp">
            <Icon name="clock" size={11} />
            {t('data.stepList.temporary')}
          </span>
          <span className="muted">{t('data.stepList.deletedWhenRunEnds')}</span>
        </div>
        <p className="m-0 text-label text-fg-muted">
          {t('data.stepList.onlyOutputKept')}
        </p>
      </InspectorSection>
    </>
  )
}

function TryResult() {
  const editor = usePipelineEditor()
  const [open, setOpen] = useState(false)
  const result = editor.trialResult

  if (!result) {
    return (
      <InspectorSection title={t('data.stepList.tryResult')}>
        <p className="m-0 text-label leading-[18px]">
          {t('data.stepList.notTriedYet')}
        </p>
      </InspectorSection>
    )
  }

  const { report } = result
  const stale = result.ranWith !== editor.configKey

  return (
    <InspectorSection title={t('data.stepList.tryResult')}>
      {report.ok ? (
        <p className="m-0 text-label leading-[18px]">
          {report.stoppedAt
            ? t('data.stepList.tryStopped', { step: report.stoppedAt.step })
            : t('data.stepList.tryOk', {
                rows: report.preview.rowCount,
                seconds: (report.durationMs / 1000).toFixed(1),
              })}
        </p>
      ) : (
        <p className="m-0 text-label leading-[18px] text-danger-text">
          {report.errorMessage}
        </p>
      )}
      {stale ? (
        <p className="m-0 mt-1 text-label text-warn-text">
          {t('data.trialPanel.changedDraftAfterRan')}
        </p>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <BoardButton size="sm" onClick={() => setOpen(true)}>
          {t('data.stepList.showRows')}
        </BoardButton>
        <BoardButton
          size="sm"
          icon="play"
          disabled={editor.tryDraft.isPending || !editor.canSave}
          onClick={() =>
            editor.trialDetails
              ? editor.tryDraft.mutate(editor.trialDetails)
              : editor.startTrial()
          }
        >
          {stale
            ? t('data.trialPanel.tryNewDraft')
            : t('common.actions.tryAgain')}
        </BoardButton>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader title={t('data.trialPanel.ariaTryDraftResult')} />
          <DialogBody>
            <TrialPanel
              result={report}
              stale={stale}
              onTryAgain={() => {
                setOpen(false)

                if (editor.trialDetails)
                  editor.tryDraft.mutate(editor.trialDetails)
                else editor.startTrial()
              }}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </InspectorSection>
  )
}

function DraftSection() {
  const editor = usePipelineEditor()
  const { config, draft, current } = editor

  if (!config) return null

  // A step's own problems show on its row; the rest belong to the pipeline.
  const aboutPipeline = editor.errors.filter(
    (error) => !error.field.startsWith('steps['),
  )

  return (
    <InspectorSection title={t('data.stepList.draftSection')}>
      <p className="m-0 text-label leading-[18px]">
        {draft
          ? t('data.stepList.draftSaved', {
              version: draft.version,
              when: formatNotebookDateTime(draft.updated_at, { zone: true }),
            })
          : t('data.stepList.noDraftYet')}{' '}
        {current?.lifecycle === 'published'
          ? t('data.stepList.runsKeepUsing', { version: current.version })
          : t('data.stepList.publishToRun')}
      </p>
      <div className="mt-3 text-xs">
        <label htmlFor="pipeline-description" className="muted">
          {t('data.pipelineSteps.description')}
        </label>
        <BoardInput
          id="pipeline-description"
          className="mt-1"
          placeholder={t('data.pipelineSteps.whatPipeline')}
          value={config.description ?? ''}
          onChange={(e) =>
            editor.setConfig((c) => {
              const { description: _d, ...rest } = c

              return e.target.value
                ? { ...rest, description: e.target.value }
                : rest
            })
          }
        />
      </div>
      {aboutPipeline.length ? (
        <ul className="m-0 mt-3 flex list-none flex-col gap-0.5 p-0 text-label text-danger-text">
          {aboutPipeline.slice(0, 6).map((error) => (
            <li key={`${error.field}:${error.message}`}>{error.message}</li>
          ))}
        </ul>
      ) : null}
    </InspectorSection>
  )
}
