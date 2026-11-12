import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { Banner } from '#/components/ui/alert'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { PickerSelect } from '#/components/record-picker/entity-picker'
import { personOption } from '#/components/record-picker/entity-options'
import { ArgumentField } from '#/components/pipelines/plugin-steps-editor'
import { pluginStepSources } from '#/components/pipelines/plugin-step-sources'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import { parsePluginName } from '#/lib/extensions/points'
import type { OperationInput } from '#/lib/operations/descriptor'
import { pipelineActions } from '#/lib/operations/registry'
import { notebookDataClient } from '#/lib/notebook-data'
import { CONFIRM_NO_ANSWER_OUTCOMES } from '#/lib/pipelines/config'
import type {
  ConfirmNoAnswerOutcome,
  PipelineInput,
  PipelineParameter,
  PipelinePluginStep,
  PipelineStep,
  PipelineStepAction,
} from '#/lib/pipelines/config'
import { actionLabel, pluginLabel } from './kinds'

const OUTCOME_LABELS: Record<ConfirmNoAnswerOutcome, string> = {
  reask: t('data.stepsEditor.askAgain'),
  apply: t('data.stepsEditor.applyStep'),
  fail: t('data.stepsEditor.failRun'),
}

/** The webhook destinations a notify step can post to. */
export interface Destination {
  id: string
  key: string
  description: string | null
  status: string
}

export function useNotificationDestinations() {
  return useQuery({
    queryKey: ['ui-port', 'pipelines', 'notification-destinations', 'all'],
    queryFn: () =>
      notebookDataClient.list<Destination>(
        'webhook_subscriptions',
        '?select=id,key,description,status&order=key.asc',
      ),
    staleTime: 60_000,
  })
}

export const destinationName = (d: Destination) =>
  d.description?.trim() || d.key

/** The body of an ask step: who is asked, what happens when nobody answers, what Skip leaves out. */
export function AskStepBody({
  step,
  others,
  members,
  onChange,
}: {
  step: Extract<PipelineStep, { kind: 'ask' }>
  /** The other steps a Skip can leave out. */
  others: string[]
  members: Record<string, string>
  onChange: (step: Extract<PipelineStep, { kind: 'ask' }>) => void
}) {
  const { ask } = step
  const memberIds = Object.keys(members)

  const patch = (next: Partial<typeof ask>) =>
    onChange({ ...step, ask: { ...ask, ...next } })

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={t('data.stepsEditor.asked')}>
        <PickerSelect
          noun="person"
          aria-label={t('data.stepList.askedPerson')}
          value={ask.askedUserIds[0] ?? ''}
          onChange={(id) => patch({ askedUserIds: id ? [id] : [] })}
          options={memberIds.map((id) => personOption(id, members[id]))}
        />
      </Field>
      <Field label={t('data.stepsEditor.ifNobodyAnswers')}>
        <Select
          aria-label={t('data.stepsEditor.ifNobodyAnswers')}
          value={ask.noAnswer ?? 'reask'}
          onChange={(e) => {
            const noAnswer = CONFIRM_NO_ANSWER_OUTCOMES.find(
              (o) => o === e.target.value,
            )

            if (noAnswer) patch({ noAnswer })
          }}
        >
          {CONFIRM_NO_ANSWER_OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {OUTCOME_LABELS[outcome]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('data.stepList.expiresAfter')}
        hint={t('data.stepList.expiresHint')}
      >
        <Input
          inputMode="numeric"
          aria-label={t('data.stepList.expiresAfter')}
          value={ask.expiresHours ?? ''}
          onChange={(e) => {
            const hours = Number(e.target.value)

            if (e.target.value === '') {
              const { expiresHours: _e, ...rest } = ask

              onChange({ ...step, ask: rest })
            } else if (Number.isInteger(hours) && hours > 0)
              patch({ expiresHours: hours })
          }}
        />
      </Field>
      <Field label={t('data.stepsEditor.skippingLeavesOut')}>
        <Select
          multiple
          aria-label={t('data.stepsEditor.skippingLeavesOut')}
          value={ask.skipSteps ?? []}
          onChange={(e) =>
            patch({
              skipSteps: [...e.target.selectedOptions].map((o) => o.value),
            })
          }
        >
          {others.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

/** The body of a notify step: which webhook destination it posts to. */
export function NotifyStepBody({
  step,
  taken,
  onChange,
}: {
  step: Extract<PipelineStep, { kind: 'notify' }>
  /** Destinations other notify steps already use; one is used once. */
  taken: string[]
  onChange: (step: Extract<PipelineStep, { kind: 'notify' }>) => void
}) {
  const destinations = useNotificationDestinations()
  const list = destinations.data ?? []

  return (
    <div className="flex flex-col gap-2">
      <Field label={t('data.stepList.notifyDestination')}>
        <Select
          aria-label={t('data.stepList.notifyDestination')}
          value={step.notify.subscriptionId}
          onChange={(e) =>
            onChange({
              ...step,
              notify: { ...step.notify, subscriptionId: e.target.value },
            })
          }
        >
          <option value="">{t('data.stepList.chooseDestination')}</option>
          {list
            .filter(
              (d) =>
                d.id === step.notify.subscriptionId || !taken.includes(d.id),
            )
            .map((d) => (
              <option key={d.id} value={d.id}>
                {destinationName(d)}
                {d.status === 'active' ? '' : ` (${d.status})`}
              </option>
            ))}
        </Select>
      </Field>
      {destinations.isSuccess && list.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.stepList.noDestinations')}
        </p>
      ) : null}
      <p className="m-0 text-label text-fg-muted">
        {t('data.stepList.notifyWhen')}
      </p>
    </div>
  )
}

/** The OperationInput an action argument is edited as. */
function inputOf(
  argument: ReturnType<typeof pipelineActions>[number]['arguments'][number],
): OperationInput {
  const type =
    argument.type === 'boolean'
      ? 'bool'
      : argument.type === 'integer' || argument.type === 'bigint'
        ? 'int'
        : argument.type === 'numeric'
          ? 'num'
          : 'text'

  const input: OperationInput = {
    name: argument.name,
    type,
    required: argument.required,
  }

  if (argument.nullable) input.nullable = true

  return input
}

/** The body of an ELN action step: what it does, whether a person decides, and its boxes. */
export function ActionStepBody({
  step,
  workspaceId,
  parameters,
  onChange,
}: {
  step: Extract<PipelineStep, { kind: 'action' }>
  workspaceId: string
  parameters: PipelineParameter[]
  onChange: (step: Extract<PipelineStep, { kind: 'action' }>) => void
}) {
  const points = useExtensionPoints()

  const definitions = useMemo(
    () => pipelineActions(workspaceId),
    // Extensions installed or removed change what is on offer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, points.descriptors],
  )

  const { action } = step
  const definition = definitions.find((d) => d.operation === action.operation)
  const canPropose = Boolean(definition?.proposalKind)
  const mode = action.mode ?? 'execute'

  const set = (next: Partial<PipelineStepAction>) =>
    onChange({ ...step, action: { ...action, ...next } })

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('data.stepList.actionWhich')}>
        <Select
          aria-label={t('data.stepList.actionWhich')}
          value={action.operation}
          onChange={(e) => {
            const next = definitions.find((d) => d.operation === e.target.value)

            set({
              operation: e.target.value,
              arguments: {},
              mode: next?.proposalKind ? 'propose' : 'execute',
            })
          }}
        >
          <option value="">{t('data.stepList.chooseAction')}</option>
          {action.operation && !definition ? (
            <option value={action.operation}>{action.operation}</option>
          ) : null}
          {definitions.map((d) => (
            <option key={d.operation} value={d.operation}>
              {actionLabel(d.operation) || d.label}
            </option>
          ))}
        </Select>
      </Field>
      {action.operation && !definition ? (
        <Banner tone="warn" title={t('data.pluginSteps.missing')}>
          {t('data.pluginSteps.missingBody', {
            operation: parsePluginName(action.operation)
              ? action.operation
              : action.operation,
          })}
        </Banner>
      ) : null}
      {definition ? (
        <p className="m-0 text-label text-fg-muted">{definition.description}</p>
      ) : null}
      {definition ? (
        <>
          <Field label={t('data.stepList.actionMode')}>
            <Select
              aria-label={t('data.stepList.actionMode')}
              value={canPropose ? mode : 'execute'}
              disabled={!canPropose}
              onChange={(e) =>
                set({
                  mode: e.target.value === 'propose' ? 'propose' : 'execute',
                })
              }
            >
              {canPropose ? (
                <option value="propose">
                  {t('data.stepList.modePropose')}
                </option>
              ) : null}
              <option value="execute">{t('data.stepList.modeDo')}</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-body">
            <Checkbox
              checked={Boolean(action.forEach)}
              onCheckedChange={(on) => {
                const { forEach: _f, ...rest } = action

                onChange({
                  ...step,
                  action: on
                    ? { ...rest, forEach: { $ref: 'previous' } }
                    : rest,
                })
              }}
            />
            {t('data.stepList.forEachRow')}
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {definition.arguments
              .filter((a) => !a.server)
              .map((argument) => (
                <ArgumentField
                  key={argument.name}
                  input={inputOf(argument)}
                  isTable={false}
                  value={action.arguments[argument.name]}
                  parameters={parameters}
                  tableSources={[]}
                  rows={Boolean(action.forEach)}
                  onChange={(value) => {
                    const next = { ...action.arguments }

                    if (value === undefined) delete next[argument.name]
                    else next[argument.name] = value
                    set({ arguments: next })
                  }}
                />
              ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** The body of a plugin step: which plugin step runs, and where each of its tables and settings comes from. */
export function PluginStepBody({
  plugin,
  index,
  steps,
  inputs,
  parameters,
  onChange,
}: {
  plugin: PipelinePluginStep
  index: number
  steps: PipelineStep[]
  inputs: PipelineInput[]
  parameters: PipelineParameter[]
  onChange: (plugin: PipelinePluginStep) => void
}) {
  const points = useExtensionPoints()

  // Only a plugin step that turns tables into a table can run between steps.
  const pluginSteps = points.descriptors.filter(
    (d) => points.callables.get(d.name)?.point === 'pipeline-steps',
  )

  const operation = plugin.operation
  const descriptor = points.descriptors.find((d) => d.name === operation)
  const args = plugin.arguments
  const known = pluginSteps.some((entry) => entry.name === operation)
  const tableNames = new Set(points.callables.get(operation)?.tableNames ?? [])

  const earlier = steps
    .slice(0, index)
    .filter(
      (s) => s.kind !== 'action' && s.kind !== 'notify' && s.kind !== 'ask',
    )

  const sources = pluginStepSources({
    hasPrevious: earlier.length > 0,
    transformRuns: earlier.length > 0,
    inputs,
    earlier: earlier.map((s) => s.name),
  })

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('data.stepsEditor.pluginStepWhich')}>
        <Select
          aria-label={t('data.stepsEditor.pluginStepWhich')}
          value={operation}
          onChange={(event) => {
            const next = event.target.value

            // A table the plugin reads starts as the result so far, or the
            // first input when nothing has run yet.
            onChange({
              operation: next,
              arguments: Object.fromEntries(
                (points.callables.get(next)?.tableNames ?? []).map((table) => [
                  table,
                  { $ref: sources.at(0)?.ref ?? 'previous' },
                ]),
              ),
            })
          }}
        >
          <option value="">{t('data.pluginSteps.choose')}</option>
          {operation && !known ? (
            <option value={operation}>{pluginLabel(operation)}</option>
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
            isTable={tableNames.has(input.name)}
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
