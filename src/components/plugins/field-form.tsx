import { Checkbox } from '#/components/ui/checkbox'
import { DateField } from '#/components/ui/date-field'
import { Field, Input } from '#/components/ui/input'
import type { ExtensionField } from '#/lib/extensions/points'
import { fieldLabel } from './field-values'
import type { FieldValues } from './field-values'

/**
 * A form for the named, typed values a plugin declared: the box for each, with
 * its label and unit. Used wherever a plugin asks the person for something
 * (a calculator's inputs, an exporter's options, a connector's parameters).
 * Values are held as the text the person typed; `readFieldValues` turns them
 * into what the plugin declared, or names what is missing.
 */

export { fieldLabel, formatFieldValue, readFieldValues } from './field-values'

export type { FieldValues, ReadFieldValues } from './field-values'

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

  const maskedNames = new Set(masked)

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
                type={maskedNames.has(field.name) ? 'password' : undefined}
                autoComplete={maskedNames.has(field.name) ? 'off' : undefined}
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
