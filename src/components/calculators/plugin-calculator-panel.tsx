import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'

import {
  FieldForm,
  fieldLabel,
  formatFieldValue,
  readFieldValues,
} from '#/components/plugins/field-form'
import type {
  FieldValues,
  ReadFieldValues,
} from '#/components/plugins/field-form'
import { Button } from '#/components/ui/button'
import { Select } from '#/components/ui/select'
import { t } from '#/copy'
import { runPluginCallable } from '#/lib/extensions/use-extension-points'
import type { PluginRunAnswer } from '#/lib/extensions/use-extension-points'
import type { RunnerItem } from '#/lib/extensions/runner-points'
import type { ExtensionOperationDeclaration } from '#/lib/extensions/points'

type Calculator = RunnerItem<ExtensionOperationDeclaration>

/** What a calculator's declared fields produce: the plugin's own input object. */
type PluginInput = Extract<ReadFieldValues, { ok: true }>['input']

/** A returned value, when it is a number: the one kind a result card can show. */
const pluginNumber = z.number()

/** What the dialog's result card and "Insert" use: the first number the plugin returned. */
export interface PluginAnswer {
  value: number
  unitLabel: string
  label: string
  workings: string
  note?: string
}

/** What one finished run can show: its first declared number, and the rest. */
interface PluginRun {
  input: PluginInput
  output: PluginRunAnswer['output']
}

/**
 * The result card for one run. The first declared output the plugin answered
 * with a number becomes the answer; every declared input and every other
 * returned value is named in the workings, so the card never shows a figure
 * without saying what produced it.
 */
function pluginAnswer(
  calculator: Calculator,
  run: PluginRun,
): PluginAnswer | null {
  const outputs = calculator.declaration.outputs
  let first: (typeof outputs)[number] | null = null
  let value = 0

  for (const field of outputs) {
    if (field.type !== 'number' && field.type !== 'integer') continue
    const reading = pluginNumber.safeParse(run.output[field.name])

    if (!reading.success) continue
    first = field
    value = reading.data
    break
  }

  if (!first) return null

  const inputs = calculator.declaration.inputs
    .filter((field) => run.input[field.name] !== undefined)
    .map(
      (field) =>
        `${fieldLabel(field)} ${formatFieldValue(run.input[field.name])}${field.unit ? ` ${field.unit}` : ''}`,
    )
    .join(', ')

  const others = outputs
    .filter((field) => field !== first && run.output[field.name] != null)
    .map(
      (field) =>
        `${fieldLabel(field)} ${formatFieldValue(run.output[field.name])}${field.unit ? ` ${field.unit}` : ''}`,
    )
    .join(' · ')

  return {
    value,
    unitLabel: first.unit ?? '',
    label: `${calculator.declaration.title}: ${fieldLabel(first)}`,
    workings: t('calculators.plugin.workings', {
      title: calculator.declaration.title,
      plugin: calculator.extensionName,
      inputs,
    }),
    note: others || undefined,
  }
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

  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- A calculation writes nothing: this mutation only carries the plugin's answer back, which the panel reads from its own result, so no cached query changes.
  const run = useMutation({
    mutationFn: async (input: PluginInput) => ({
      input,
      ...(await runPluginCallable({
        extensionKey: active.extensionKey,
        itemId: active.id,
        input,
      })),
    }),
    onSuccess: (data) => onAnswer(pluginAnswer(active, data)),
  })

  /** Drop the last run and the answer the dialog is showing for it. */
  function forget() {
    run.reset()
    onAnswer(null)
  }

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
            forget()
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

          if (run.data) forget()
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
