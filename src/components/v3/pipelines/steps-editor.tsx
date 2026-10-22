import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
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
  reask: 'Ask again',
  apply: 'Apply the step',
  fail: 'Fail the run',
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
}: {
  steps: PipelineStep[]
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
          No further steps. The transform above is the whole pipeline.
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step, index) => {
          const n = index + 1
          const confirm = step.confirm
          return (
            <li
              key={index}
              className="flex flex-col gap-2 rounded-md border border-border-subtle p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-label text-fg-muted">{n}</span>
                <Input
                  className="mono h-8 w-[180px] text-xs"
                  aria-label={`Step ${n} name`}
                  value={step.name}
                  onChange={(e) =>
                    onChange(updateStep(steps, index, { name: e.target.value }))
                  }
                />
                <Select
                  size="sm"
                  aria-label={`Step ${n} language`}
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
                  <option value="sql">SQL</option>
                  <option value="python">Python</option>
                </Select>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Move step ${n} up`}
                  disabled={index === 0}
                  onClick={() => onChange(moveStep(steps, index, -1))}
                >
                  Up
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Move step ${n} down`}
                  disabled={index === steps.length - 1}
                  onClick={() => onChange(moveStep(steps, index, 1))}
                >
                  Down
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Remove step ${n}`}
                  onClick={() => onChange(removeStep(steps, index))}
                >
                  Remove
                </Button>
              </div>
              {step.language === 'python' && python ? (
                <PythonStepEditor
                  label={`Step ${n}`}
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
                <textarea
                  aria-label={`Step ${n} code`}
                  value={step.statement}
                  rows={4}
                  spellCheck={false}
                  onChange={(e) =>
                    onChange(
                      updateStep(steps, index, { statement: e.target.value }),
                    )
                  }
                  className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                />
              )}
              <label className="flex items-center gap-2 text-body">
                <Checkbox
                  aria-label={`Step ${n} waits for a person`}
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
                Pause for a person to confirm
              </label>
              {confirm ? (
                <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
                  <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                    Asked
                    <Select
                      aria-label={`Step ${n} asked person`}
                      value={confirm.askedUserIds[0] ?? ''}
                      onChange={(e) =>
                        onChange(
                          setConfirmPatch(steps, index, {
                            askedUserIds: e.target.value
                              ? [e.target.value]
                              : [],
                          }),
                        )
                      }
                    >
                      <option value="">Choose a person</option>
                      {memberIds.map((id) => (
                        <option key={id} value={id}>
                          {members[id]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                    If nobody answers
                    <Select
                      aria-label={`Step ${n} no answer`}
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
                    Skipping leaves out
                    <Select
                      aria-label={`Step ${n} skips`}
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
      <div>
        <Button
          size="sm"
          icon="plus"
          disabled={steps.length >= 9}
          onClick={() => onChange(addStep(steps))}
        >
          Add step
        </Button>
      </div>
    </div>
  )
}
