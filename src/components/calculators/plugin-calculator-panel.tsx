import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import {
  FieldForm,
  fieldLabel,
  formatFieldValue,
  readFieldValues,
} from '#/components/plugins/field-form'
import type { FieldValues } from '#/components/plugins/field-form'
import { Button } from '#/components/ui/button'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { runPluginCallable } from '#/lib/extensions/use-extension-points'
import type { RunnerItem } from '#/lib/extensions/runner-points'
import type { ExtensionOperationDeclaration } from '#/lib/extensions/points'

type Calculator = RunnerItem<ExtensionOperationDeclaration>

/** What the dialog's result card and "Insert" use: the first number the plugin returned. */
export interface PluginAnswer {
  value: number
  unitLabel: string
  label: string
  workings: string
  note?: string
}

/**
 * Calculators that installed plugins add. The person picks one, fills in what
 * it asks for and presses Calculate; the plugin's Python runs in the isolated
 * runner and every result it declared comes back here. Nothing is saved.
 */
export function PluginCalculatorPanel({
  calculators,
  onAnswer,
}: {
  calculators: Calculator[]
  onAnswer: (answer: PluginAnswer | null) => void
}) {
  const [name, setName] = useState(calculators[0]?.name ?? '')
  const [values, setValues] = useState<FieldValues>({})
  const active = calculators.find((c) => c.name === name) ?? calculators[0]
  const [missing, setMissing] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: async (input: Record<string, unknown>) => ({
      input,
      ...(await runPluginCallable({
        extensionKey: active.extensionKey,
        itemId: active.id,
        input,
      })),
    }),
  })
  const calculate = () => {
    const read = readFieldValues(active.declaration.inputs, values)
    if (!read.ok) {
      setMissing(read.missing[0])
      return
    }
    setMissing(null)
    run.mutate(read.input)
  }

  const outputs = active.declaration.outputs
  const result = run.data

  const answer = useMemo<PluginAnswer | null>(() => {
    if (!result) return null
    const first = outputs.find(
      (field) =>
        (field.type === 'number' || field.type === 'integer') &&
        typeof result.output[field.name] === 'number',
    )
    if (!first) return null
    const inputs = active.declaration.inputs
      .filter((field) => result.input[field.name] !== undefined)
      .map(
        (field) =>
          `${fieldLabel(field)} ${formatFieldValue(result.input[field.name])}${field.unit ? ` ${field.unit}` : ''}`,
      )
      .join(', ')
    const others = outputs
      .filter((field) => field !== first && result.output[field.name] != null)
      .map(
        (field) =>
          `${fieldLabel(field)} ${formatFieldValue(result.output[field.name])}${field.unit ? ` ${field.unit}` : ''}`,
      )
      .join(' · ')
    return {
      value: result.output[first.name] as number,
      unitLabel: first.unit ?? '',
      label: `${active.declaration.title}: ${fieldLabel(first)}`,
      workings: t('calculators.plugin.workings', {
        title: active.declaration.title,
        plugin: active.extensionName,
        inputs,
      }),
      note: others || undefined,
    }
  }, [result, outputs, active])
  useEffect(() => onAnswer(answer), [answer, onAnswer])

  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1 text-label">
        <span className="font-medium text-fg">
          {t('calculators.plugin.choose')}
        </span>
        <Select
          value={active.name}
          aria-label={t('calculators.plugin.choose')}
          onChange={(event) => {
            setName(event.target.value)
            setValues({})
            setMissing(null)
            run.reset()
          }}
        >
          {calculators.map((calculator) => (
            <option key={calculator.name} value={calculator.name}>
              {calculator.declaration.title}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-label text-fg-muted">
        {active.declaration.description}{' '}
        {t('calculators.plugin.from', { name: active.extensionName })}
      </p>
      <FieldForm
        fields={active.declaration.inputs}
        values={values}
        onChange={(next) => {
          setValues(next)
          if (run.data) run.reset()
        }}
      />
      <div>
        <Button
          variant="secondary"
          disabled={run.isPending}
          onClick={calculate}
        >
          {run.isPending
            ? t('calculators.plugin.calculating')
            : t('calculators.plugin.calculate')}
        </Button>
      </div>
      {missing || run.error ? (
        <p className="text-label text-danger-text" role="status">
          {missing
            ? t('calculators.plugin.needsInputs', { name: missing })
            : t('calculators.plugin.failed', {
                reason: run.error?.message ?? '',
              })}
        </p>
      ) : null}
      {result ? (
        <dl
          className="grid gap-1 rounded-md border border-border p-3 text-body"
          aria-label={t('calculators.plugin.outputs')}
        >
          {outputs.map((field) =>
            result.output[field.name] === undefined ? null : (
              <div key={field.name} className="flex justify-between gap-3">
                <dt className="text-fg-muted">{fieldLabel(field)}</dt>
                <dd className="tabular-nums text-fg">
                  {formatFieldValue(result.output[field.name])}
                  {field.unit ? ` ${field.unit}` : ''}
                </dd>
              </div>
            ),
          )}
        </dl>
      ) : null}
    </div>
  )
}
