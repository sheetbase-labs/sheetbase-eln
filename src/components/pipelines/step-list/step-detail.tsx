import { useState } from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { CodeBlock } from '#/components/ui/code-block'
import { Field, Input } from '#/components/ui/input'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/ui/confirm-dialog'
import { PythonStepEditor } from '#/components/pipelines/python-editor'
import { SqlEditor } from '#/components/pipelines/sql-editor'
import type { PythonRuntimeInfo } from '#/components/pipelines/pipelines-data'
import type {
  PipelineConfig,
  PipelineNoCodeStep,
  PipelineStep,
} from '#/lib/pipelines/config'
import { isNoCodeKind } from '#/lib/pipelines/no-code/forms'
import type { NoCodeKind } from '#/lib/pipelines/no-code/forms'
import { noCodeStatement } from '#/lib/pipelines/no-code/generate'
import {
  previousDataStep,
  withContract,
  withForm,
} from '#/lib/pipelines/step-list'
import { NoCodeFormFields } from './no-code-form'
import {
  ActionStepBody,
  AskStepBody,
  NotifyStepBody,
  PluginStepBody,
} from './step-bodies'
import type { StepFacts } from './use-pipeline-editor'

/** What the selected step is, written out for editing below its row. */
export function StepDetail({
  config,
  index,
  workspaceId,
  members,
  runtime,
  facts,
  onChange,
  onConvertToSql,
}: {
  config: PipelineConfig
  index: number
  workspaceId: string
  members: Record<string, string>
  runtime: PythonRuntimeInfo | undefined
  facts: Partial<Record<string, StepFacts>>
  onChange: (step: PipelineStep) => void
  onConvertToSql: () => void
}) {
  const step = config.steps[index]
  const { inputs, parameters } = config
  const before = previousDataStep(config.steps, index)

  // The columns of the rows this step reads, as the last try or run showed them.
  const columns = before ? (facts[before.name]?.columns ?? []) : []

  const inputColumns = Object.fromEntries(
    inputs.map((input) => [input.name, facts[input.name]?.columns ?? []]),
  )

  return (
    <div
      className="flex flex-col gap-3 px-3 pb-3 pl-10"
      data-testid="step-detail"
    >
      <StepIdentity
        step={step}
        others={config.steps}
        index={index}
        onChange={onChange}
      />
      {isNoCodeKind(step.kind) && 'form' in step ? (
        <NoCodeBody
          step={step}
          kind={step.kind}
          index={index}
          columns={columns}
          inputs={inputs}
          inputColumns={inputColumns}
          onChange={onChange}
          onConvertToSql={onConvertToSql}
        />
      ) : null}
      {step.kind === 'sql' ? (
        <SqlEditor
          aria-label={t('data.stepList.sqlCode', { n: index + 1 })}
          value={step.statement}
          rows={8}
          onChange={(e) => onChange({ ...step, statement: e.target.value })}
        />
      ) : null}
      {step.kind === 'python' ? (
        <PythonStepEditor
          label={t('data.stepList.stepN', { n: index + 1 })}
          statement={step.statement}
          onStatementChange={(statement) => onChange({ ...step, statement })}
          contract={step.contract}
          onContractChange={(contract) =>
            onChange(withContract({ ...step }, contract))
          }
          inputs={inputs}
          parameters={parameters}
          hasPrevious={Boolean(before)}
          runtime={runtime}
          requirements={config.pythonRequirements}
        />
      ) : null}
      {step.kind === 'plugin' ? (
        <PluginStepBody
          plugin={step.plugin}
          index={index}
          steps={config.steps}
          inputs={inputs}
          parameters={parameters}
          onChange={(plugin) => onChange({ ...step, plugin })}
        />
      ) : null}
      {step.kind === 'ask' ? (
        <AskStepBody
          step={step}
          members={members}
          others={config.steps
            .map((s) => s.name)
            .filter((n) => n !== step.name)}
          onChange={onChange}
        />
      ) : null}
      {step.kind === 'action' ? (
        <ActionStepBody
          step={step}
          workspaceId={workspaceId}
          parameters={parameters}
          onChange={onChange}
        />
      ) : null}
      {step.kind === 'notify' ? (
        <NotifyStepBody
          step={step}
          taken={config.steps.flatMap((s) =>
            s.kind === 'notify' && s !== step ? [s.notify.subscriptionId] : [],
          )}
          onChange={onChange}
        />
      ) : null}
    </div>
  )
}

/** The step's name and its note, which the people reading the pipeline see and the run never reads. */
function StepIdentity({
  step,
  others,
  index,
  onChange,
}: {
  step: PipelineStep
  others: PipelineStep[]
  index: number
  onChange: (step: PipelineStep) => void
}) {
  const taken = others.some((s, i) => i !== index && s.name === step.name)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
      <Field
        label={t('data.stepList.stepName')}
        error={taken ? t('data.pipelineConfig.stepNamesMustUnique') : undefined}
      >
        <Input
          className="mono text-xs"
          aria-label={t('data.stepList.stepNameAria', { n: index + 1 })}
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
        />
      </Field>
      <Field
        label={t('data.stepList.stepNote')}
        hint={t('data.stepList.stepNoteHint')}
      >
        <Input
          aria-label={t('data.stepList.stepNoteAria', { n: index + 1 })}
          value={step.note ?? ''}
          onChange={(e) => {
            const { note: _note, ...rest } = step

            onChange(e.target.value ? { ...rest, note: e.target.value } : rest)
          }}
        />
      </Field>
    </div>
  )
}

/** A no-code step: the form, the SQL it writes (read-only) and Edit as SQL…, one way. */
function NoCodeBody({
  step,
  kind,
  index,
  columns,
  inputs,
  inputColumns,
  onChange,
  onConvertToSql,
}: {
  step: PipelineNoCodeStep
  kind: NoCodeKind
  index: number
  columns: string[]
  inputs: Array<{ name: string }>
  inputColumns: Record<string, string[]>
  onChange: (step: PipelineStep) => void
  onConvertToSql: () => void
}) {
  const [asking, setAsking] = useState(false)
  const made = noCodeStatement(kind, step.form)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex overflow-hidden rounded-md border border-border"
          role="group"
          aria-label={t('data.stepList.editStepAs', { n: index + 1 })}
        >
          <Button
            variant="secondary"
            size="sm"
            aria-pressed="true"
            className="rounded-none border-0 bg-selection-subtle"
          >
            {t('data.stepList.form')}
          </Button>
          <Button
            variant="quiet"
            size="sm"
            aria-haspopup="dialog"
            className="rounded-none border-0 border-l border-border"
            onClick={() => setAsking(true)}
          >
            {t('data.stepList.editAsSql')}
          </Button>
        </div>
        <span className="min-w-0 flex-1 text-label text-fg-muted">
          {t('data.stepList.formWritesSql')}
        </span>
      </div>
      <NoCodeFormFields
        kind={kind}
        form={step.form}
        columns={columns}
        inputs={inputs}
        inputColumns={inputColumns}
        onChange={(form) => onChange(withForm(step, form))}
      />
      <div className="flex items-baseline gap-2 text-label">
        <span className="font-medium">{t('data.stepList.generatedSql')}</span>
        <span className="text-fg-muted">
          {t('data.stepList.readOnlyWhileForm')}
        </span>
      </div>
      <CodeBlock
        language="sql"
        label={t('data.stepList.generatedSqlAria', { n: index + 1 })}
        code={made.ok ? made.statement : step.statement}
        maxHeight="md"
      />
      {made.ok ? null : (
        <p className="m-0 text-label text-warn-text" role="status">
          {made.reason}
        </p>
      )}
      <ConfirmDialog open={asking} onOpenChange={setAsking}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('data.stepList.editAsSqlTitle', { n: index + 1 })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t('data.stepList.editAsSqlBody')}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel>
              {t('common.actions.cancel')}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              onClick={() => {
                setAsking(false)
                onConvertToSql()
              }}
            >
              {t('data.stepList.editAsSqlConfirm')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
