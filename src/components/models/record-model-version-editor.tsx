import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/input'
import { Muted } from '#/components/ui/layout'
import { Textarea } from '#/components/inventory/list'
import { Select } from '#/components/ui/select'
import { FIELD_LOGICAL_TYPES } from '#/lib/field-definition'
import type { FieldLogicalType } from '#/lib/field-definition'
import type { ModelMetadataPatch } from '#/lib/model-fields'
import type {
  ModelChangeScope,
  RecordModelVersion,
  RecordModelVersionDefinition,
} from '#/lib/record-model-versions'
import type { ModelFieldImpact } from './model-field-impact'
import { RecordModelFieldDefinitionEditor } from './record-model-field-definition-editor'
import { t } from '#/copy'

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
  const publishedKeys = new Set(publishedFieldNames)

  const originalFieldIds = new Set(
    version.definition.fields.map((field) => field.id),
  )

  const fieldKeys = new Set(definition.fields.map((field) => field.field_name))

  function updateField(id: string, patch: ModelMetadataPatch<VersionField>) {
    setDefinition((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    }))
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
        {t(
          'library.models.recordModelVersionEditor.draftVRevisionPublishedDefinitions',
          { version: version.version, revision: version.revision },
        )}
      </p>
      <section
        aria-label={t(
          'library.models.recordModelVersionEditor.draftFieldDefinitions',
        )}
        className="divide-y divide-border rounded-md border border-border"
      >
        {definition.fields.length === 0 ? (
          <p className="p-3 text-label text-fg-muted">
            {t('library.models.recordModelVersionEditor.noFieldsYetAddA')}
          </p>
        ) : null}
        {definition.fields.map((field) => (
          <RecordModelFieldDefinitionEditor
            key={field.id}
            field={field}
            locked={publishedKeys.has(field.field_name)}
            publishedVersion={publishedVersion}
            busy={busy}
            open={!originalFieldIds.has(field.id)}
            choiceInput={choiceInputs[field.id]}
            onChoiceInputChange={(input) =>
              setChoiceInputs((current) => ({ ...current, [field.id]: input }))
            }
            onChange={(patch) => updateField(field.id, patch)}
          />
        ))}
      </section>
      <fieldset
        disabled={busy}
        className="grid min-w-0 grid-cols-2 items-end gap-3 border-0 p-0"
      >
        <legend className="mb-2 text-label font-semibold">
          {t('library.models.recordModelVersionEditor.addField')}
        </legend>
        <Field label={t('library.models.recordModelVersionEditor.stableKey')}>
          <Input value={key} onChange={(event) => setKey(event.target.value)} />
        </Field>
        <Field label={t('library.models.recordModelVersionEditor.label')}>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field label={t('library.models.recordModelVersionEditor.type')}>
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
              fieldKeys.has(key)
            ) {
              setError(
                t(
                  'library.models.recordModelVersionEditor.useAUniqueLowercaseField',
                ),
              )

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
          {t('library.models.recordModelVersionEditor.addField')}
        </Button>
      </fieldset>

      <section
        aria-label={t('library.models.recordModelVersionEditor.impact')}
        className="flex flex-col gap-3 border-t border-border pt-4"
      >
        <h3 className="m-0 text-label font-semibold">
          {t('library.models.recordModelVersionEditor.impactOnExistingWork')}
        </h3>
        <div className="flex flex-col gap-1 text-label text-fg-muted">
          {impact.recordsOnEachVersion.map((row) => (
            <span key={row.versionId}>
              {t(
                'library.models.recordModelVersionEditor.recordsUseVTheyKeep',
                { count: row.recordCount, version: row.version },
              )}
            </span>
          ))}
          <span>
            {t('library.models.recordModelVersionEditor.templatesAndSheets', {
              templates: t('library.models.counts.templates', {
                count: impact.templates,
              }),
              sheets: t('library.models.counts.sheets', {
                count: impact.sheets,
              }),
            })}
          </span>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-label font-medium text-fg">
            {t(
              'library.models.recordModelVersionEditor.whatHappensToExistingRecords',
            )}
          </legend>
          <label className="flex items-start gap-2 text-label">
            <input
              type="radio"
              className="mt-0.5 shrink-0"
              name="migration-scope"
              checked={scope === 'new-records-only'}
              onChange={() => setScope('new-records-only')}
            />
            {t('library.models.recordModelVersionEditor.newRecordsOnly')}
          </label>
          <label className="flex items-start gap-2 text-label">
            <input
              type="radio"
              className="mt-0.5 shrink-0"
              name="migration-scope"
              checked={scope === 'also-migrate-open-experiments'}
              onChange={() => setScope('also-migrate-open-experiments')}
            />
            {t(
              'library.models.recordModelVersionEditor.alsoMigrateEligibleOpenRecords',
              { migratableRecords: impact.migratableRecords },
            )}
          </label>
        </fieldset>
      </section>

      {error ? (
        <p role="alert" className="text-label text-danger-text">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <Field
          label={t('library.models.recordModelVersionEditor.reasonForChange')}
          required
        >
          <Textarea
            value={reason}
            maxLength={500}
            required
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {!reason.trim() ? (
          <Muted>
            {t('library.models.recordModelVersionEditor.enterAReasonBeforeThe')}
          </Muted>
        ) : null}
        <Button
          className="self-end"
          variant="primary"
          type="submit"
          disabled={busy || !reason.trim()}
        >
          {busy
            ? t('common.states.saving')
            : t('library.models.recordModelVersionEditor.saveDraft')}
        </Button>
      </div>
    </form>
  )
}
