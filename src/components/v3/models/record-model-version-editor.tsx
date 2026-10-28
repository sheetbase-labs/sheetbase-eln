import { useState } from 'react'

import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Muted } from '#/components/v3/ui/layout'
import { Textarea } from '#/components/v3/inventory/list'
import { Select } from '#/components/v3/ui/select'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import type { FieldLogicalType } from '#/lib/field-definition'
import type {
  ModelChangeScope,
  RecordModelVersion,
  RecordModelVersionDefinition,
} from '#/lib/record-model-versions'
import type { ModelFieldImpact } from './model-field-impact'

type VersionField = RecordModelVersionDefinition['fields'][number]

/**
 * MDL-02.3 — the field editor, at the design's contract. A field's definition
 * (type, unit, required, allowed range) is edited in place; the stable key is
 * locked once the field has been published, and the editor says why. Applying
 * the change needs a reason for change and the steward's migration scope, and
 * the impact of the change is shown before it is applied.
 */
export function RecordModelVersionEditor({
  version,
  impact,
  publishedFieldNames = [],
  publishedVersion,
  busy,
  onSave,
}: {
  version: RecordModelVersion
  impact: ModelFieldImpact
  /** Keys already published: their identity is fixed, so the editor locks them. */
  publishedFieldNames?: string[]
  publishedVersion?: number | null
  busy: boolean
  onSave: (
    definition: RecordModelVersionDefinition,
    reason: string,
    scope: ModelChangeScope,
  ) => void
}) {
  const [definition, setDefinition] = useState(version.definition)
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState<ModelChangeScope>(
    version.definition.migrationScope === 'also-migrate-open-experiments'
      ? 'also-migrate-open-experiments'
      : 'new-records-only',
  )
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [logicalType, setLogicalType] = useState<FieldLogicalType>('text')
  const [error, setError] = useState<string | null>(null)
  const [choiceInputs, setChoiceInputs] = useState<Record<string, string>>({})

  function updateField(id: string, patch: Partial<VersionField>) {
    setDefinition((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    }))
  }

  function updateValidation(id: string, bound: 'min' | 'max', raw: string) {
    const field = definition.fields.find((item) => item.id === id)
    if (!field) return
    const validation = { ...field.validation }
    if (raw === '') delete validation[bound]
    else validation[bound] = Number(raw)
    updateField(id, { validation })
  }

  function updateUnit(
    id: string,
    property: 'kind' | 'dimension' | 'storageUnit',
    value: string,
  ) {
    const field = definition.fields.find((item) => item.id === id)
    if (!field) return
    const quantity = {
      kind: '',
      dimension: '',
      storageUnit: '',
      ...field.quantity,
      [property]: value.trim(),
    }
    updateField(id, {
      quantity:
        quantity.kind || quantity.dimension || quantity.storageUnit
          ? quantity
          : null,
    })
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-5"
      onInvalidCapture={(event) => {
        // Native validation must reveal an invalid field even when its row
        // has been collapsed, so the browser can focus the actual control.
        if (event.target instanceof HTMLElement) {
          const details = event.target.closest('details')
          if (details) details.open = true
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        onSave(definition, reason.trim(), scope)
      }}
    >
      <p className="m-0 text-label text-fg-muted">
        Draft v{version.version}, revision {version.revision}. Published
        definitions and recorded values do not change.
      </p>
      <section
        aria-label="Draft field definitions"
        className="divide-y divide-border rounded-md border border-border"
      >
        {definition.fields.length === 0 ? (
          <p className="p-3 text-label text-fg-muted">
            No fields yet. Add a field below to define this record type.
          </p>
        ) : null}
        {definition.fields.map((field) => {
          const locked = publishedFieldNames.includes(field.field_name)
          const numeric =
            field.logical_type === 'integer' || field.logical_type === 'decimal'
          const quantity = field.quantity
          const unit =
            quantity &&
            typeof quantity === 'object' &&
            'storageUnit' in quantity
              ? quantity.storageUnit
              : undefined
          return (
            <details
              key={field.id}
              className="group min-w-0"
              open={
                !version.definition.fields.some((item) => item.id === field.id)
              }
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-label hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                <Icon
                  name="chevronDown"
                  size={14}
                  className="shrink-0 -rotate-90 text-fg-muted group-open:rotate-0"
                />
                <span className="min-w-0 flex-1 break-words font-medium">
                  {field.label || field.field_name}
                </span>
                <span className="text-fg-muted">
                  {field.logical_type}
                  {field.lifecycle === 'retired' ? ' · retired' : ''}
                </span>
              </summary>
              <fieldset
                disabled={busy}
                className="m-0 flex min-w-0 flex-col gap-4 border-0 border-t border-border-subtle px-3 pb-4 pt-3"
              >
                <legend className="sr-only">
                  {field.label || field.field_name} configuration
                </legend>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Label">
                    <Input
                      value={field.label}
                      required
                      onChange={(event) =>
                        updateField(field.id, { label: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="Key"
                    hint={
                      locked
                        ? `Locked: published in v${publishedVersion ?? '—'}. Stable identity on saved records.`
                        : 'Not yet published. The key can still change.'
                    }
                  >
                    <Input
                      aria-label="Field key"
                      className="mono"
                      value={field.field_name}
                      disabled={locked}
                      onChange={(event) =>
                        updateField(field.id, {
                          field_name: event.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                <div>
                  <Field label="Type">
                    <Select
                      aria-label="Field type"
                      value={field.logical_type}
                      onChange={(event) =>
                        updateField(field.id, {
                          logical_type:
                            FIELD_LOGICAL_TYPES.find(
                              (type) => type === event.target.value,
                            ) ?? 'text',
                        })
                      }
                    >
                      {FIELD_LOGICAL_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {numeric ? (
                  <div className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
                    <h4 className="col-span-2 text-label font-semibold">
                      Quantity
                    </h4>
                    <div className="col-span-2">
                      <Field
                        label="Unit"
                        hint="Storage unit. Changing it does not convert existing values."
                      >
                        <Input
                          aria-label="Unit"
                          required={Boolean(field.quantity)}
                          placeholder="e.g. NTU"
                          value={typeof unit === 'string' ? unit : ''}
                          onChange={(event) =>
                            updateUnit(
                              field.id,
                              'storageUnit',
                              event.target.value,
                            )
                          }
                        />
                      </Field>
                    </div>
                    <Field
                      label="Quantity kind"
                      hint="Scientific meaning, e.g. mass or viability."
                    >
                      <Input
                        value={field.quantity?.kind ?? ''}
                        required={Boolean(field.quantity)}
                        onChange={(event) =>
                          updateUnit(field.id, 'kind', event.target.value)
                        }
                      />
                    </Field>
                    <Field
                      label="Dimension"
                      hint="Physical dimension, e.g. mass or ratio."
                    >
                      <Input
                        value={field.quantity?.dimension ?? ''}
                        required={Boolean(field.quantity)}
                        onChange={(event) =>
                          updateUnit(field.id, 'dimension', event.target.value)
                        }
                      />
                    </Field>
                  </div>
                ) : null}
                {field.logical_type === 'reference' ? (
                  <Field
                    label="Target record type key"
                    hint="A built-in or workspace Record Model key, e.g. sample or cell_bank."
                  >
                    <Input
                      value={
                        typeof field.validation.targetModelKey === 'string'
                          ? field.validation.targetModelKey
                          : ''
                      }
                      required
                      onChange={(event) =>
                        updateField(field.id, {
                          validation: {
                            ...field.validation,
                            targetModelKey: event.target.value,
                          },
                          relationship: {
                            target: {
                              kind: 'model',
                              modelKey: event.target.value,
                            },
                            cardinality: 'one',
                          },
                        })
                      }
                    />
                  </Field>
                ) : null}
                {field.logical_type === 'category' ? (
                  <Field
                    label="Allowed choices"
                    hint="One choice per line. Existing choice labels are preserved."
                  >
                    <Textarea
                      value={
                        choiceInputs[field.id] ??
                        (field.options ?? [])
                          .filter((option) => option.lifecycle === 'active')
                          .map((option) => option.key)
                          .join('\n')
                      }
                      onChange={(event) => {
                        setChoiceInputs((current) => ({
                          ...current,
                          [field.id]: event.target.value,
                        }))
                        const keys = [
                          ...new Set(
                            event.target.value
                              .split('\n')
                              .map((choiceKey) => choiceKey.trim())
                              .filter(Boolean),
                          ),
                        ]
                        const existing = field.options ?? []
                        updateField(field.id, {
                          category_source: { kind: 'embedded' },
                          options: [
                            ...existing.map((option) => ({
                              ...option,
                              lifecycle: keys.includes(option.key)
                                ? ('active' as const)
                                : ('retired' as const),
                            })),
                            ...keys
                              .filter(
                                (choiceKey) =>
                                  !existing.some(
                                    (option) => option.key === choiceKey,
                                  ),
                              )
                              .map((choiceKey, index) => ({
                                id: crypto.randomUUID(),
                                key: choiceKey,
                                label: choiceKey,
                                displayOrder: existing.length + index,
                                lifecycle: 'active' as const,
                              })),
                          ],
                        })
                      }}
                    />
                  </Field>
                ) : null}
                <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
                  <h4 className="text-label font-semibold">
                    Validation and defaults
                  </h4>
                  <label className="flex items-center gap-2 text-label">
                    <input
                      type="checkbox"
                      checked={!field.nullable}
                      onChange={(event) =>
                        updateField(field.id, {
                          nullable: !event.target.checked,
                        })
                      }
                    />
                    Required for new records
                  </label>
                  {numeric ? (
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
                            onChange={(event) =>
                              updateValidation(
                                field.id,
                                bound,
                                event.target.value,
                              )
                            }
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
                </div>
                <label className="flex items-start gap-2 border-t border-border-subtle pt-3 text-label">
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={field.lifecycle === 'retired'}
                    onChange={(event) =>
                      updateField(field.id, {
                        lifecycle: event.target.checked ? 'retired' : 'active',
                      })
                    }
                  />
                  Retire field, keep its historical values
                </label>
              </fieldset>
            </details>
          )
        })}
      </section>
      <fieldset
        disabled={busy}
        className="grid min-w-0 grid-cols-2 items-end gap-3 border-0 p-0"
      >
        <legend className="mb-2 text-label font-semibold">Add field</legend>
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
          <Select
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
          </Select>
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

      <section
        aria-label="Impact"
        className="flex flex-col gap-3 border-t border-border pt-4"
      >
        <h3 className="m-0 text-label font-semibold">
          Impact on existing work
        </h3>
        <div className="flex flex-col gap-1 text-label text-fg-muted">
          {impact.recordsOnEachVersion.map((row) => (
            <span key={row.versionId}>
              {row.recordCount} record{row.recordCount === 1 ? '' : 's'} use v
              {row.version}. They keep their saved values unless migrated.
            </span>
          ))}
          <span>
            {impact.templates} template
            {impact.templates === 1 ? '' : 's'} and {impact.sheets} sheet
            {impact.sheets === 1 ? '' : 's'} depend on this model.
          </span>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-label font-medium text-fg">
            What happens to existing records
          </legend>
          <label className="flex items-start gap-2 text-label">
            <input
              type="radio"
              className="mt-0.5 shrink-0"
              name="migration-scope"
              checked={scope === 'new-records-only'}
              onChange={() => setScope('new-records-only')}
            />
            New records only
          </label>
          <label className="flex items-start gap-2 text-label">
            <input
              type="radio"
              className="mt-0.5 shrink-0"
              name="migration-scope"
              checked={scope === 'also-migrate-open-experiments'}
              onChange={() => setScope('also-migrate-open-experiments')}
            />
            Also migrate eligible open records after publication (
            {impact.migratableRecords})
          </label>
        </fieldset>
      </section>

      {error ? (
        <p role="alert" className="text-label text-danger-text">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <Field label="Reason for change" required>
          <Textarea
            value={reason}
            maxLength={500}
            required
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {!reason.trim() ? (
          <Muted>Enter a reason before the change can be applied.</Muted>
        ) : null}
        <Button
          className="self-end"
          variant="primary"
          type="submit"
          disabled={busy || !reason.trim()}
        >
          {busy ? 'Saving…' : 'Save draft'}
        </Button>
      </div>
    </form>
  )
}
