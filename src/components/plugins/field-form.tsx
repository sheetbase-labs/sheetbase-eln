import { t } from '#/copy'
import { Checkbox } from '#/components/ui/checkbox'
import { DateField } from '#/components/ui/date-field'
import { Field, Input } from '#/components/ui/input'
import type { ExtensionField } from '#/lib/extensions/points'

/**
 * A form for the named, typed values a plugin declared: the box for each, with
 * its label and unit. Used wherever a plugin asks the person for something
 * (a calculator's inputs, an exporter's options, a connector's parameters).
 * Values are held as the text the person typed; `readFieldValues` turns them
 * into what the plugin declared, or names what is missing.
 */

/** `seeding_density` becomes "Seeding density" when the plugin gave no label. */
export function fieldLabel(field: ExtensionField): string {
  if (field.label) return field.label
  const spaced = field.name.replaceAll('_', ' ')

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export type FieldValues = Record<string, string>

export type ReadFieldValues =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; missing: string[] }

export function readFieldValues(
  fields: readonly ExtensionField[],
  values: FieldValues,
): ReadFieldValues {
  const input: Record<string, unknown> = {}
  const missing: string[] = []

  for (const field of fields) {
    const raw = (values[field.name] ?? '').trim()

    if (field.type === 'boolean') {
      input[field.name] = raw === 'true'
      continue
    }

    if (raw === '') {
      if (field.required) missing.push(fieldLabel(field))
      continue
    }

    if (field.type === 'number' || field.type === 'integer') {
      const n = Number(raw)

      const ok =
        Number.isFinite(n) && (field.type === 'number' || Number.isInteger(n))

      if (!ok) {
        missing.push(fieldLabel(field))
        continue
      }

      input[field.name] = n
    } else if (field.type === 'json') {
      try {
        input[field.name] = JSON.parse(raw)
      } catch {
        missing.push(fieldLabel(field))
      }
    } else input[field.name] = raw
  }

  return missing.length ? { ok: false, missing } : { ok: true, input }
}

export function FieldForm({
  fields,
  values,
  onChange,
  disabled,
  masked,
}: {
  fields: readonly ExtensionField[]
  values: FieldValues
  onChange: (values: FieldValues) => void
  disabled?: boolean
  /** Field names typed as secrets: shown as dots, and not offered to autofill. */
  masked?: readonly string[]
}) {
  const set = (name: string, value: string) =>
    onChange({ ...values, [name]: value })

  return (
    <div className="grid gap-3">
      {fields.map((field) => {
        const label = fieldLabel(field)

        if (field.type === 'boolean')
          return (
            <label
              key={field.name}
              className="flex items-center gap-2 text-body text-fg"
            >
              <Checkbox
                checked={values[field.name] === 'true'}
                disabled={disabled}
                onCheckedChange={(next) =>
                  set(field.name, next === true ? 'true' : 'false')
                }
              />
              <span>{label}</span>
            </label>
          )

        if (field.type === 'date')
          return (
            <Field
              key={field.name}
              label={label}
              hint={field.description}
              required={field.required}
            >
              <DateField
                label={label}
                placeholder={label}
                value={values[field.name] || undefined}
                onChange={(day) => set(field.name, day ?? '')}
              />
            </Field>
          )

        return (
          <Field
            key={field.name}
            label={label}
            hint={field.description}
            required={field.required}
          >
            <span className="flex items-center gap-2">
              <Input
                value={values[field.name] ?? ''}
                disabled={disabled}
                inputMode={
                  field.type === 'number' || field.type === 'integer'
                    ? 'decimal'
                    : undefined
                }
                aria-label={label}
                type={masked?.includes(field.name) ? 'password' : undefined}
                autoComplete={masked?.includes(field.name) ? 'off' : undefined}
                onChange={(event) => set(field.name, event.target.value)}
              />
              {field.unit ? (
                <span className="shrink-0 text-label text-fg-muted">
                  {field.unit}
                </span>
              ) : null}
            </span>
          </Field>
        )
      })}
    </div>
  )
}

/** A value a plugin returned, as a person reads it. */
export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'boolean')
    return value ? t('calculators.plugin.yes') : t('calculators.plugin.no')

  if (typeof value === 'number')
    return Number.isInteger(value)
      ? String(value)
      : String(Number(value.toPrecision(6)))

  if (typeof value === 'string') return value

  return JSON.stringify(value)
}
