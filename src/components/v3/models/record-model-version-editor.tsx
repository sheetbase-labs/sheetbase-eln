import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Textarea } from '#/components/v3/inventory/list'
import { NativeSelect } from '#/components/v3/projects/select'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import type { FieldLogicalType } from '#/lib/field-definition'
import type {
  RecordModelVersion,
  RecordModelVersionDefinition,
} from '#/lib/record-model-versions'

export function RecordModelVersionEditor({
  version,
  busy,
  onSave,
}: {
  version: RecordModelVersion
  busy: boolean
  onSave: (definition: RecordModelVersionDefinition, reason: string) => void
}) {
  const [definition, setDefinition] = useState(version.definition)
  const [reason, setReason] = useState('')
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [logicalType, setLogicalType] = useState<FieldLogicalType>('text')
  const [error, setError] = useState<string | null>(null)

  function updateField(
    id: string,
    patch: Partial<RecordModelVersionDefinition['fields'][number]>,
  ) {
    setDefinition((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    }))
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(definition, reason.trim())
      }}
    >
      <p className="m-0 text-label text-fg-muted">
        Draft v{version.version}, revision {version.revision}. Published
        definitions and recorded values do not change.
      </p>
      {definition.fields.map((field) => (
        <fieldset
          key={field.id}
          disabled={busy}
          className="flex flex-col gap-2 border-b border-border-subtle pb-3"
        >
          <legend className="mono text-label">{field.field_name}</legend>
          <Field label="Label">
            <Input
              value={field.label}
              required
              onChange={(event) =>
                updateField(field.id, { label: event.target.value })
              }
            />
          </Field>
          <div className="flex gap-3 text-label text-fg-muted">
            <span>{field.logical_type}</span>
          </div>
          <label className="flex items-center gap-2 text-label">
            <input
              type="checkbox"
              checked={!field.nullable}
              onChange={(event) =>
                updateField(field.id, { nullable: !event.target.checked })
              }
            />
            Required for new records
          </label>
          {field.logical_type === 'integer' ||
          field.logical_type === 'decimal' ? (
            <div className="grid grid-cols-2 gap-2">
              {(['min', 'max'] as const).map((bound) => (
                <Field
                  key={bound}
                  label={bound === 'min' ? 'Minimum' : 'Maximum'}
                >
                  <Input
                    type="number"
                    step="any"
                    value={
                      typeof field.validation[bound] === 'number'
                        ? String(field.validation[bound])
                        : ''
                    }
                    onChange={(event) => {
                      const validation = { ...field.validation }
                      if (event.target.value === '') delete validation[bound]
                      else validation[bound] = Number(event.target.value)
                      updateField(field.id, { validation })
                    }}
                  />
                </Field>
              ))}
              <Field label="Default for new records">
                <Input
                  type="number"
                  step="any"
                  value={
                    typeof field.default_value === 'number'
                      ? String(field.default_value)
                      : ''
                  }
                  onChange={(event) =>
                    updateField(field.id, {
                      default_value:
                        event.target.value === ''
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </Field>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-label">
            <input
              type="checkbox"
              checked={field.lifecycle === 'retired'}
              onChange={(event) =>
                updateField(field.id, {
                  lifecycle: event.target.checked ? 'retired' : 'active',
                })
              }
            />
            Retire field, keep its identity and historical values
          </label>
        </fieldset>
      ))}
      <fieldset disabled={busy} className="grid grid-cols-2 gap-2">
        <legend className="mb-2 text-section">Add field</legend>
        <Field label="Stable key">
          <Input value={key} onChange={(event) => setKey(event.target.value)} />
        </Field>
        <Field label="Label">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field label="Type">
          <NativeSelect
            value={logicalType}
            onChange={(event) =>
              setLogicalType(
                FIELD_LOGICAL_TYPES.find(
                  (type) => type === event.target.value,
                ) ?? 'text',
              )
            }
          >
            {FIELD_LOGICAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button
          type="button"
          onClick={() => {
            if (
              !/^[a-z][a-z0-9_]*$/.test(key) ||
              !label.trim() ||
              definition.fields.some((field) => field.field_name === key)
            ) {
              setError('Use a unique lowercase field key and a label.')
              return
            }
            setDefinition((current) => ({
              ...current,
              fields: [
                ...current.fields,
                {
                  id: crypto.randomUUID(),
                  field_name: key,
                  label: label.trim(),
                  logical_type: logicalType,
                  nullable: true,
                  display_order: current.fields.length,
                  lifecycle: 'active',
                  default_value: null,
                  validation: {},
                  cardinality: 'one',
                  options: [],
                },
              ],
            }))
            setKey('')
            setLabel('')
            setError(null)
          }}
        >
          Add field
        </Button>
      </fieldset>
      {error ? (
        <p role="alert" className="text-label text-danger-text">
          {error}
        </p>
      ) : null}
      <Field label="Reason for change" required>
        <Textarea
          value={reason}
          maxLength={500}
          required
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <Button variant="primary" type="submit" disabled={busy || !reason.trim()}>
        {busy ? 'Saving…' : 'Save draft'}
      </Button>
    </form>
  )
}
