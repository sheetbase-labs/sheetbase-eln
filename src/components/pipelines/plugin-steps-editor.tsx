import { useMemo, useState } from 'react'
import { z } from 'zod'

import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'
import { parsePluginName } from '#/lib/extensions/points'
import type { OperationInput } from '#/lib/operations/descriptor'
import type { PipelineParameter } from '#/lib/pipelines/config'
import type { PipelineConfigView as PipelineConfig } from '#/lib/pipelines/config-view'
import type { TableSource } from './plugin-step-sources'

export type PipelineActionConfig = NonNullable<
  PipelineConfig['actions']
>[number]

const isPlugin = (action: PipelineActionConfig) =>
  parsePluginName(action.operation) !== null

const referenceSchema = z.object({ $ref: z.string() })

/** `plugin_step_2`-style name that is free in this pipeline. */
function freeName(base: string, taken: readonly string[]): string {
  const stem = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const start = /^[a-z]/.test(stem) ? stem : `p_${stem}`
  const names = new Set(taken)
  let name = start.slice(0, 44)

  for (let n = 2; names.has(name); n += 1) name = `${start.slice(0, 44)}_${n}`

  return name
}

/**
 * The plugin steps a pipeline runs once its result is ready: a plugin that
 * reshapes the table, checks it, or sends it to another system. Each is picked
 * from the plugins installed in this workspace, and every box it asks for is
 * filled from the result so far, a pipeline setting, or a value typed here.
 * What the plugin does stays in its own code; nothing here can make it do more.
 */
export function PluginStepsEditor({
  actions,
  parameters,
  onChange,
}: {
  actions: PipelineActionConfig[]
  parameters: PipelineParameter[]
  onChange: (actions: PipelineActionConfig[]) => void
}) {
  const points = useExtensionPoints()
  const [choice, setChoice] = useState('')
  const plugin = actions.filter(isPlugin)

  const byName = useMemo(
    () => new Map(points.descriptors.map((d) => [d.name, d])),
    [points.descriptors],
  )

  const set = (name: string, patch: Partial<PipelineActionConfig>) =>
    onChange(
      actions.map((action) =>
        action.name === name ? { ...action, ...patch } : action,
      ),
    )

  const add = (operation: string) => {
    const descriptor = byName.get(operation)

    if (!descriptor) return
    const callable = points.callables.get(operation)
    const args: PipelineActionConfig['arguments'] = {}

    // A table the plugin reads starts as the result so far, the usual case.
    for (const name of callable?.tableNames ?? [])
      args[name] = { $ref: 'previous' }
    onChange([
      ...actions,
      {
        name: freeName(
          parsePluginName(operation)?.id ?? 'step',
          actions.map((a) => a.name),
        ),
        operation,
        arguments: args,
      },
    ])
    setChoice('')
  }

  const addable = points.descriptors.filter(
    (d) => d.pipeline && actions.length < 20,
  )

  return (
    <div className="flex flex-col gap-4">
      {plugin.length === 0 ? (
        <p className="m-0 text-body text-fg-muted">
          {t('data.pluginSteps.none')}
        </p>
      ) : null}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {plugin.map((action, index) => {
          const descriptor = byName.get(action.operation)
          const callable = points.callables.get(action.operation)
          const tables = new Set(callable?.tableNames ?? [])

          const earlierSteps = plugin
            .slice(0, index)
            .filter(
              (earlier) =>
                points.callables.get(earlier.operation)?.point ===
                'pipeline-steps',
            )

          return (
            <li
              key={action.name}
              className="flex flex-col gap-3 rounded-md border border-border-subtle p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-label text-fg-muted">
                  {index + 1}
                </span>
                <span className="font-medium text-fg">
                  {descriptor?.label ?? action.operation}
                </span>
                {descriptor && callable?.point === 'publishers' ? (
                  <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-caption text-fg-muted">
                    {t('data.pluginSteps.sendsOut')}
                  </span>
                ) : null}
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={index === 0}
                  aria-label={t('data.pluginSteps.moveUp', { n: index + 1 })}
                  onClick={() => {
                    const at = actions.findIndex((a) => a.name === action.name)

                    const before = actions.findIndex(
                      (a) => a.name === plugin[index - 1].name,
                    )

                    const next = [...actions]

                    ;[next[at], next[before]] = [next[before], next[at]]
                    onChange(next)
                  }}
                >
                  {t('data.stepsEditor.up')}
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={t('data.pluginSteps.remove', { n: index + 1 })}
                  onClick={() =>
                    onChange(actions.filter((a) => a.name !== action.name))
                  }
                >
                  {t('common.actions.remove')}
                </Button>
              </div>
              {descriptor ? (
                <p className="m-0 text-label text-fg-muted">
                  {descriptor.description}
                </p>
              ) : (
                <Banner tone="warn" title={t('data.pluginSteps.missing')}>
                  {t('data.pluginSteps.missingBody', {
                    operation: action.operation,
                  })}
                </Banner>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(descriptor?.inputs ?? []).map((input) => (
                  <ArgumentField
                    key={input.name}
                    input={input}
                    isTable={tables.has(input.name)}
                    value={action.arguments[input.name]}
                    parameters={parameters}
                    tableSources={[
                      {
                        ref: 'previous',
                        label: t('data.pluginSteps.resultSoFar'),
                      },
                      ...earlierSteps.map((step) => ({
                        ref: `actions.${step.name}.rows`,
                        label: t('data.pluginSteps.rowsFrom', {
                          name: step.name,
                        }),
                      })),
                    ]}
                    onChange={(value) => {
                      const next = { ...action.arguments }

                      if (value === undefined) delete next[input.name]
                      else next[input.name] = value
                      set(action.name, { arguments: next })
                    }}
                  />
                ))}
              </div>
            </li>
          )
        })}
      </ol>
      {addable.length === 0 ? (
        <p className="m-0 text-label text-fg-muted">
          {t('data.pluginSteps.noPlugins')}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('data.pluginSteps.add')} className="min-w-[260px]">
            <Select
              value={choice}
              aria-label={t('data.pluginSteps.add')}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="">{t('data.pluginSteps.choose')}</option>
              {addable.map((descriptor) => (
                <option key={descriptor.name} value={descriptor.name}>
                  {descriptor.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            size="sm"
            icon="plus"
            disabled={!choice}
            onClick={() => add(choice)}
          >
            {t('data.pluginSteps.addButton')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * One box of a plugin step: a table (picked from where it can come from), a
 * yes/no, or a value typed here or taken from a pipeline setting.
 */
export function ArgumentField({
  input,
  isTable,
  value,
  parameters,
  tableSources,
  onChange,
}: {
  input: OperationInput
  isTable: boolean
  value: PipelineActionConfig['arguments'][string] | undefined
  parameters: PipelineParameter[]
  tableSources: TableSource[]
  onChange: (
    value: PipelineActionConfig['arguments'][string] | undefined,
  ) => void
}) {
  const label = input.name.replaceAll('_', ' ')
  const caption = label.charAt(0).toUpperCase() + label.slice(1)
  const reference = referenceSchema.safeParse(value)

  if (isTable) {
    const current = reference.success
      ? reference.data.$ref
      : (tableSources.at(0)?.ref ?? 'previous')

    return (
      <Field label={caption} hint={input.description} required={input.required}>
        <Select
          value={current}
          aria-label={caption}
          onChange={(event) => onChange({ $ref: event.target.value })}
        >
          {tableSources.map((source) => (
            <option key={source.ref} value={source.ref}>
              {source.label}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  const matching = parameters.filter((parameter) =>
    input.type === 'num' || input.type === 'int'
      ? ['number', 'integer', 'decimal'].includes(parameter.type)
      : true,
  )

  const ref = reference.success ? reference.data.$ref : null
  const mode = ref?.startsWith('parameters.') ? ref : 'typed'
  const typed = z.union([z.string(), z.number()]).safeParse(value)

  if (input.type === 'bool')
    return (
      <label className="flex items-center gap-2 text-body text-fg">
        <Checkbox
          checked={value === true}
          onCheckedChange={(next) => onChange(next === true)}
        />
        {caption}
      </label>
    )

  return (
    <Field label={caption} hint={input.description} required={input.required}>
      <div className="flex flex-col gap-1.5">
        {matching.length > 0 ? (
          <Select
            size="sm"
            aria-label={t('data.pluginSteps.takenFrom', { name: caption })}
            value={mode}
            onChange={(event) =>
              onChange(
                event.target.value === 'typed'
                  ? undefined
                  : { $ref: event.target.value },
              )
            }
          >
            <option value="typed">{t('data.pluginSteps.typedHere')}</option>
            {matching.map((parameter) => (
              <option
                key={parameter.name}
                value={`parameters.${parameter.name}`}
              >
                {t('data.pluginSteps.fromParameter', { name: parameter.name })}
              </option>
            ))}
          </Select>
        ) : null}
        {mode === 'typed' ? (
          <Input
            value={typed.success ? String(typed.data) : ''}
            inputMode={
              input.type === 'num' || input.type === 'int'
                ? 'decimal'
                : undefined
            }
            onChange={(event) => {
              const text = event.target.value

              if (text === '') return onChange(undefined)

              if (input.type === 'num' || input.type === 'int') {
                const n = Number(text)

                return onChange(Number.isFinite(n) ? n : text)
              }

              onChange(text)
            }}
          />
        ) : null}
      </div>
    </Field>
  )
}
