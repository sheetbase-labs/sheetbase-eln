import { t } from '#/copy'
import { SqlEditor } from '#/components/pipelines/sql-editor'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { personOption } from '#/components/record-picker/entity-options'
import { Select } from '#/components/ui/select'
import { PythonStepEditor } from '#/components/pipelines/python-editor'
import {
  ArgumentField,
  pluginStepSources,
} from '#/components/pipelines/plugin-steps-editor'
import { Banner } from '#/components/ui/alert'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import { parsePluginName } from '#/lib/extensions/points'
import type { OperationInput } from '#/lib/operations/descriptor'
import type { PythonRuntimeInfo } from '#/components/pipelines/pipelines-data'
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
  setStepPlugin,
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
  const points = useExtensionPoints()
  // Only a plugin step that turns tables into a table can run between steps.
  const pluginSteps = points.descriptors.filter(
    (d) => points.callables.get(d.name)?.point === 'pipeline-steps',
  )
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
                  {pluginSteps.length > 0 || step.language === 'plugin' ? (
                    <option value="plugin">
                      {t('data.stepsEditor.pluginStep')}
                    </option>
                  ) : null}
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
              {step.language === 'plugin' ? (
                <PluginStepBody
                  step={step}
                  pluginSteps={pluginSteps}
                  descriptors={
                    new Map(points.descriptors.map((d) => [d.name, d]))
                  }
                  tablesOf={(operation) =>
                    points.callables.get(operation)?.tableNames ?? []
                  }
                  sources={pluginStepSources({
                    hasPrevious: index > 0 || (python?.transformRuns ?? false),
                    transformRuns: python?.transformRuns ?? false,
                    inputs: python?.inputs ?? [],
                    earlier: steps.slice(0, index).map((other) => other.name),
                  })}
                  parameters={python?.parameters ?? []}
                  onChange={(plugin) =>
                    onChange(setStepPlugin(steps, index, plugin))
                  }
                />
              ) : step.language === 'python' && python ? (
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
              {step.language === 'plugin' ? null : (
                <label className="flex items-center gap-2 text-body">
                  <Checkbox
                    aria-label={t('data.stepsEditor.ariaStepWaitsPerson', {
                      n,
                    })}
                    checked={Boolean(confirm)}
                    onCheckedChange={(on) =>
                      onChange(
                        setStepConfirm(
                          steps,
                          index,
                          on
                            ? defaultConfirm(memberIds.slice(0, 1))
                            : undefined,
                        ),
                      )
                    }
                  />
                  {t('data.stepsEditor.pausePersonConfirm')}
                </label>
              )}
              {confirm ? (
                <div className="flex flex-col gap-2 border-l-2 border-border pl-3">
                  <label className="flex flex-col gap-0.5 text-label text-fg-muted">
                    {t('data.stepsEditor.asked')}
                    <PickerSelect
                      noun="person"
                      aria-label={t('data.stepsEditor.ariaStepAskedPerson', {
                        n,
                      })}
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

/**
 * The body of a plugin step: which plugin step runs, and where each of its
 * tables and settings comes from. The plugin's own code is not shown here: it
 * lives in the plugin, and nothing in the pipeline can make it do more.
 */
function PluginStepBody({
  step,
  pluginSteps,
  descriptors,
  tablesOf,
  sources,
  parameters,
  onChange,
}: {
  step: PipelineStep
  pluginSteps: Array<{ name: string; label: string }>
  descriptors: Map<
    string,
    {
      description: string
      inputs: readonly OperationInput[]
    }
  >
  tablesOf: (operation: string) => readonly string[]
  sources: Array<{ ref: string; label: string }>
  parameters: PipelineParameter[]
  onChange: (plugin: PipelineStep['plugin']) => void
}) {
  const operation = step.plugin?.operation ?? ''
  const descriptor = descriptors.get(operation)
  const args = step.plugin?.arguments ?? {}
  const known = pluginSteps.some((entry) => entry.name === operation)
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('data.stepsEditor.pluginStepWhich')}>
        <Select
          aria-label={t('data.stepsEditor.pluginStepWhich')}
          value={operation}
          onChange={(event) => {
            const next = event.target.value
            if (!next) return onChange(undefined)
            // A table the plugin reads starts as the result so far, or the
            // first input when nothing has run yet.
            onChange({
              operation: next,
              arguments: Object.fromEntries(
                tablesOf(next).map((table) => [
                  table,
                  { $ref: sources.at(0)?.ref ?? 'previous' },
                ]),
              ),
            })
          }}
        >
          <option value="">{t('data.pluginSteps.choose')}</option>
          {operation && !known ? (
            <option value={operation}>{operation}</option>
          ) : null}
          {pluginSteps.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.label}
            </option>
          ))}
        </Select>
      </Field>
      {pluginSteps.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.pluginSteps.noPlugins')}
        </p>
      ) : null}
      {operation && !descriptor ? (
        <Banner tone="warn" title={t('data.pluginSteps.missing')}>
          {t('data.pluginSteps.missingBody', {
            operation: parsePluginName(operation) ? operation : '',
          })}
        </Banner>
      ) : null}
      {descriptor ? (
        <p className="m-0 text-label text-fg-muted">{descriptor.description}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(descriptor?.inputs ?? []).map((input) => (
          <ArgumentField
            key={input.name}
            input={input}
            isTable={tablesOf(operation).includes(input.name)}
            value={args[input.name]}
            parameters={parameters}
            tableSources={sources}
            onChange={(value) => {
              const next = { ...args }
              if (value === undefined) delete next[input.name]
              else next[input.name] = value
              onChange({ operation, arguments: next })
            }}
          />
        ))}
      </div>
    </div>
  )
}
