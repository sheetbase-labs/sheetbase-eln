import { t } from '#/copy'
import { SqlEditor } from '#/components/v3/pipelines/sql-editor'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { personOption } from '#/components/v3/record-picker/entity-options'
import { Select } from '#/components/v3/ui/select'
import { PythonStepEditor } from '#/components/v3/pipelines/python-editor'
import type { PythonRuntimeInfo } from '#/components/v3/pipelines/pipelines-data'
import { CONFIRM_NO_ANSWER_OUTCOMES } from '#/lib/pipelines/config'
import type {
  ConfirmNoAnswerOutcome,
  PipelineInput,
  PipelineParameter,
  PipelineStep,
} from '#/lib/pipelines/config'
import {
  addStep,
  defaultConfirm,
  moveStep,
  removeStep,
  setConfirmPatch,
  setStepConfirm,
  setStepContract,
  setStepLanguage,
  updateStep,
} from '#/lib/pipelines/authoring'

const OUTCOME_LABELS: Record<ConfirmNoAnswerOutcome, string> = {
  reask: t('data.stepsEditor.askAgain'),
  apply: t('data.stepsEditor.applyStep'),
  fail: t('data.stepsEditor.failRun'),
}

/**
 * The steps after the main transform, in the order they run. Each receives the
 * result before it as `previous`. A step can pause the run for a named person
 * to confirm, skip or stop; without that it runs on its own.
 */
export function StepsEditor({
  steps,
  members,
  onChange,
  python,
  activeIndex,
  showAdd = true,
}: {
  steps: PipelineStep[]
  /** A workbench can show one step without changing its execution position. */
  activeIndex?: number
  showAdd?: boolean
  /** User id → display name for the people a confirm can ask. */
  members: Record<string, string>
  onChange: (steps: PipelineStep[]) => void
  /**
   * What a Python step needs to be written and tested: the declared inputs and
   * parameters, the runtime it will be pinned to and the pipeline's packages.
   * Without it a Python step gets a plain code box.
   */
  python?: {
    runtime?: PythonRuntimeInfo
    inputs: PipelineInput[]
    parameters: PipelineParameter[]
    requirements?: string[]
    /** Whether the main transform runs, so the first step reads its result. */
    transformRuns: boolean
  }
}) {
  const memberIds = Object.keys(members)
  return (
    <div className="flex flex-col gap-3">
      {steps.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.stepsEditor.furtherStepsTransformAbove')}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step, index) => {
          const n = index + 1
          const confirm = step.confirm
          return (
            <li
              key={index}
              hidden={activeIndex !== undefined && activeIndex !== index}
              className={
                activeIndex === undefined
                  ? 'flex flex-col gap-2 rounded-md border border-border-subtle p-3 [&[hidden]]:hidden'
                  : 'flex flex-col gap-3 [&[hidden]]:hidden'
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-label text-fg-muted">
                  {activeIndex === undefined ? n : t('data.stepsEditor.name')}
                </span>
                <Input
                  className="mono h-8 w-[180px] text-xs"
                  aria-label={t('data.stepsEditor.ariaStepName', { n })}
                  value={step.name}
                  onChange={(e) =>
                    onChange(updateStep(steps, index, { name: e.target.value }))
                  }
                />
                <Select
                  size="sm"
                  aria-label={t('data.stepsEditor.ariaStepLanguage', { n })}
                  value={step.language}
                  onChange={(e) =>
                    onChange(
                      setStepLanguage(
                        steps,
                        index,
                        e.target.value as PipelineStep['language'],
                        {
                          inputs: python?.inputs ?? [],
                          parameters: python?.parameters ?? [],
                          hasPrevious:
                            index > 0 || (python?.transformRuns ?? false),
                        },
                      ),
                    )
                  }
                >
                  <option value="sql">{t('data.stepsEditor.sql')}</option>
                  <option value="python">{t('data.stepsEditor.python')}</option>
                </Select>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={t('data.stepsEditor.ariaMoveStepUp', { n })}
                  disabled={index === 0}
                  onClick={() => onChange(moveStep(steps, index, -1))}
                >
                  {t('data.stepsEditor.up')}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={t('data.stepsEditor.ariaMoveStepDown', { n })}
                  disabled={index === steps.length - 1}
                  onClick={() => onChange(moveStep(steps, index, 1))}
                >
                  {t('data.stepsEditor.down')}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={t('data.stepsEditor.ariaRemoveStep', { n })}
                  onClick={() => onChange(removeStep(steps, index))}
                >
                  {t('common.actions.remove')}
                </Button>
              </div>
              {step.language === 'python' && python ? (
                <PythonStepEditor
                  label={t('data.stepsEditor.step', { n })}
                  statement={step.statement}
                  onStatementChange={(statement) =>
                    onChange(updateStep(steps, index, { statement }))
                  }
                  contract={step.contract}
                  onContractChange={(contract) =>
                    onChange(setStepContract(steps, index, contract))
                  }
                  inputs={python.inputs}
                  parameters={python.parameters}
                  hasPrevious={index > 0 || python.transformRuns}
                  runtime={python.runtime}
                  requirements={python.requirements}
                />
              ) : (
                <SqlEditor
                  aria-label={t('data.stepsEditor.ariaStepCode', { n })}
                  value={step.statement}
                  rows={activeIndex === undefined ? 4 : 12}
                  onChange={(e) =>
                    onChange(
                      updateStep(steps, index, { statement: e.target.value }),
                    )
                  }
                />
              )}
              <label className="flex items-center gap-2 text-body">
                <Checkbox
                  aria-label={t('data.stepsEditor.ariaStepWaitsPerson', { n })}
                  checked={Boolean(confirm)}
                  onCheckedChange={(on) =>
                    onChange(
                      setStepConfirm(
                        steps,
                        index,
                        on ? defaultConfirm(memberIds.slice(0, 1)) : undefined,
                      ),
                    )
                  }
                />
                {t('data.stepsEditor.pausePersonConfirm')}
              </label>
              {confirm ? (
                <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
                  <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                    Asked
                    <PickerSelect
                      noun="person"
                      aria-label={`Step ${n} asked person`}
                      value={confirm.askedUserIds[0] ?? ''}
                      onChange={(id) =>
                        onChange(
                          setConfirmPatch(steps, index, {
                            askedUserIds: id ? [id] : [],
                          }),
                        )
                      }
                      options={memberIds.map((id) =>
                        personOption(id, members[id]),
                      )}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                    {t('data.stepsEditor.ifNobodyAnswers')}
                    <Select
                      aria-label={t('data.stepsEditor.ariaStepAnswer', { n })}
                      value={confirm.noAnswer ?? 'reask'}
                      onChange={(e) =>
                        onChange(
                          setConfirmPatch(steps, index, {
                            noAnswer: e.target.value as ConfirmNoAnswerOutcome,
                          }),
                        )
                      }
                    >
                      {CONFIRM_NO_ANSWER_OUTCOMES.map((outcome) => (
                        <option key={outcome} value={outcome}>
                          {OUTCOME_LABELS[outcome]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                    {t('data.stepsEditor.skippingLeavesOut')}
                    <Select
                      aria-label={t('data.stepsEditor.ariaStepSkips', { n })}
                      multiple
                      value={confirm.skipSteps ?? []}
                      onChange={(e) =>
                        onChange(
                          setConfirmPatch(steps, index, {
                            skipSteps: [...e.target.selectedOptions].map(
                              (o) => o.value,
                            ),
                          }),
                        )
                      }
                    >
                      {steps
                        .filter((_, position) => position !== index)
                        .map((other) => (
                          <option key={other.name} value={other.name}>
                            {other.name}
                          </option>
                        ))}
                    </Select>
                  </label>
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      {showAdd ? (
        <div>
          <Button
            size="sm"
            icon="plus"
            disabled={steps.length >= 9}
            onClick={() => onChange(addStep(steps))}
          >
            {t('data.stepsEditor.addStep')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
