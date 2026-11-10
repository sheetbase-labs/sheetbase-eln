import { useState } from 'react'
import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/inventory/list'
import {
  modelFieldUnitSchema,
  modelFieldValidationSchema,
} from '#/lib/model-fields'
import type {
  ScientificColumnInput,
  ScientificLogicalType,
} from '#/lib/scientific-sheet-data'

const LOGICAL_TYPES: ScientificLogicalType[] = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
  'category',
]

const selectClass =
  'h-8 rounded-md border border-border bg-surface px-2 text-xs shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50'

const checkboxClass =
  'size-4 rounded border-border text-primary accent-primary focus-visible:ring-2 focus-visible:ring-ring/50'

function typedDefault(type: ScientificLogicalType, value: string) {
  if (type === 'text' || type === 'date' || type === 'timestamp') return value

  if (type === 'boolean') {
    if (value !== 'true' && value !== 'false')
      throw new Error(t('notebook.scientificSheetBlock.booleanDefaultMustBe'))

    return value === 'true'
  }

  const number = Number(value)

  if (
    !Number.isFinite(number) ||
    (type === 'integer' && !Number.isSafeInteger(number)) ||
    (type === 'decimal' && value.replace(/[^0-9]/g, '').length > 15)
  )
    throw new Error(t('notebook.scientificSheetBlock.defaultMustBeA', { type }))

  return number
}

export function ScientificColumnForm({
  disabled,
  isAdmin,
  onAdd,
  onError,
}: {
  disabled: boolean
  isAdmin: boolean
  onAdd: (input: ScientificColumnInput) => void
  onError: (message: string) => void
}) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState<ScientificLogicalType>('text')
  const [nullable, setNullable] = useState(true)
  const [hasDefault, setHasDefault] = useState(false)
  const [defaultText, setDefaultText] = useState('')
  const [unit, setUnit] = useState('')
  const [validation, setValidation] = useState('')
  const [options, setOptions] = useState('')

  const addColumn = () => {
    try {
      if (!label.trim())
        throw new Error(
          t('notebook.scientificSheetBlock.columnLabelIsRequired'),
        )

      const optionValues =
        type === 'category'
          ? options.split('\n').flatMap((value) => {
              const optionLabel = value.trim()

              return optionLabel
                ? [{ id: crypto.randomUUID(), label: optionLabel }]
                : []
            })
          : undefined

      if (
        optionValues &&
        new Set(optionValues.map((option) => option.label)).size !==
          optionValues.length
      )
        throw new Error(
          t('notebook.scientificSheetBlock.categoryOptionLabelsMust'),
        )

      const input: ScientificColumnInput = {
        label: label.trim(),
        logicalType: type,
        nullable,
        validation: modelFieldValidationSchema.parse(
          JSON.parse(validation.trim() || '{}'),
        ),
        options: optionValues,
      }

      if (unit.trim()) input.unit = modelFieldUnitSchema.parse(JSON.parse(unit))

      if (hasDefault) {
        const value =
          type === 'category'
            ? optionValues?.find((option) => option.label === defaultText)?.id
            : typedDefault(type, defaultText)

        if (value === undefined)
          throw new Error(
            t('notebook.scientificSheetBlock.categoryDefaultMustExactly'),
          )
        input.defaultValue = value
      }

      onAdd(input)
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : t('notebook.scientificSheetBlock.invalidColumn'),
      )
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-label font-medium text-fg-muted">
        {t('notebook.scientificSheetBlock.addColumn')}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-label text-fg-muted" htmlFor="new-col-label">
            {t('notebook.scientificSheetBlock.label')}
          </label>
          <Input
            id="new-col-label"
            aria-label={t(
              'notebook.scientificSheetBlock.newColumnLabelAriaLabel',
            )}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-label text-fg-muted" htmlFor="new-col-type">
            {t('notebook.scientificSheetBlock.type')}
          </label>
          <select
            id="new-col-type"
            aria-label={t(
              'notebook.scientificSheetBlock.newColumnTypeAriaLabel',
            )}
            className={selectClass}
            value={type}
            onChange={(e) => {
              const next = LOGICAL_TYPES.find(
                (value) => value === e.target.value,
              )

              if (next) setType(next)
            }}
          >
            {LOGICAL_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={!nullable}
            onChange={(e) => setNullable(!e.target.checked)}
          />
          {t('common.states.required')}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={hasDefault}
            onChange={(e) => setHasDefault(e.target.checked)}
          />
          {t('notebook.scientificSheetBlock.setDefault')}
        </label>
        {hasDefault ? (
          <Input
            aria-label={t(
              'notebook.scientificSheetBlock.typedDefaultAriaLabel',
            )}
            value={defaultText}
            onChange={(e) => setDefaultText(e.target.value)}
            className="h-8 max-w-48"
          />
        ) : null}
      </div>
      {type === 'category' ? (
        <div className="space-y-1">
          <label className="text-label text-fg-muted" htmlFor="cat-options">
            {t('notebook.scientificSheetBlock.categoryOptionsOnePer')}
          </label>
          <Textarea
            id="cat-options"
            aria-label={t(
              'notebook.scientificSheetBlock.categoryOptionsAriaLabel',
            )}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            className="min-h-24"
          />
        </div>
      ) : null}
      {isAdmin ? (
        <details className="rounded-md border bg-surface-muted/20 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-fg-muted">
            {t('notebook.scientificSheetBlock.advancedCustomJson')}
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-label text-fg-muted" htmlFor="unit-json">
                {t('notebook.scientificSheetBlock.unitJson')}
              </label>
              <Textarea
                id="unit-json"
                aria-label={t('notebook.scientificSheetBlock.unitJson')}
                // copy-ignore-next-line
                placeholder='{"code":"mg","symbol":"mg"}'
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="min-h-20 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-label text-fg-muted"
                htmlFor="validation-json"
              >
                {t('notebook.scientificSheetBlock.validationJson')}
              </label>
              <Textarea
                id="validation-json"
                aria-label={t('notebook.scientificSheetBlock.validationJson')}
                // copy-ignore-next-line
                placeholder='{"min":0}'
                value={validation}
                onChange={(e) => setValidation(e.target.value)}
                className="min-h-20 font-mono"
              />
            </div>
          </div>
        </details>
      ) : null}
      <Button type="button" size="sm" disabled={disabled} onClick={addColumn}>
        {t('notebook.scientificSheetBlock.addColumn')}
      </Button>
    </div>
  )
}
