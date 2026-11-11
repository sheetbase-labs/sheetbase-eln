import { t } from '#/copy'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import { definitionOfModelField } from '#/lib/model-fields'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import {
  fieldEditorPresentation,
  selectableFieldOptions,
} from '#/lib/field-presentation'
import type { DataClient } from '#/lib/data-client'
import { createDataClient } from '#/lib/data-client'
import {
  RecordReferenceCellError,
  formatRecordReferenceLabel,
  parsePersistedRecordReference,
  resolveRecordReferenceState,
  selectRecordReference,
} from '#/lib/record-reference-cell'
import type { RecordReferenceSnapshot } from '#/lib/record-reference-cell'
import { PluginFieldInput } from '#/components/extensions/plugin-field-input'
import type { PluginFieldInputSource } from '#/components/extensions/plugin-field-input'
import { EntityPickerDialog } from '#/components/record-picker/entity-picker'
import type {
  PickerOption,
  PickerSearchResult,
} from '#/components/record-picker/entity-picker'
import { modelRecordSearch } from '#/components/record-picker/entity-options'
import { pickerStatus } from '#/components/record-picker/record-picker-data'
import type { SheetRecordSearchHit } from '#/lib/sheet-record-search'
import { isReferenceTargetAllowed } from '#/lib/model-relationships'
import type { ModelRelationshipRule } from '#/lib/model-relationships'

export function ModelFieldInput({
  definition,
  value,
  onChange,
  showLabel = true,
  searchReferenceRecords,
  resolveReferenceSnapshot,
  sourceModelKey,
  relationshipRules,
  placeholder,
  pluginInput,
}: {
  definition: ModelFieldDefinition
  value: string | boolean
  onChange: (value: string | boolean) => void
  showLabel?: boolean
  /** A plugin field type's own screen to type in, instead of the standard box. */
  pluginInput?: PluginFieldInputSource
  /** What a text or number box shows while empty, such as a plugin field type's example. */
  placeholder?: string
  /** Test seam: drive the reference search without a live client. */
  searchReferenceRecords?: (query: string) => Promise<SheetRecordSearchHit[]>
  /** Test seam: resolve the current reference without a live client. */
  resolveReferenceSnapshot?: (
    recordId: string,
  ) => Promise<RecordReferenceSnapshot | null>
  /**
   * MODEL-03: the source record's Model key for relationship rules.
   * Defaults to the field's own Model.
   */
  sourceModelKey?: string
  /** MODEL-03: declared relationship rules for the source Model. */
  relationshipRules?: ModelRelationshipRule[]
}) {
  if (pluginInput)
    return (
      <PluginFieldInput
        source={pluginInput}
        definition={definition}
        value={value}
        onChange={onChange}
      />
    )
  const field = definitionOfModelField(definition)

  const presentation = fieldEditorPresentation(field.logicalType, {
    relationshipTarget: field.relationship?.target.kind,
  })

  if (presentation.kind === 'checkbox')
    return (
      <CheckboxField
        definition={definition}
        value={value}
        onChange={onChange}
        showLabel={showLabel}
      />
    )

  if (presentation.kind === 'category-select')
    return (
      <CategorySelectField
        definition={definition}
        field={field}
        value={value}
        onChange={onChange}
        showLabel={showLabel}
      />
    )

  if (presentation.kind === 'record-picker') {
    const targetModelKey =
      field.relationship?.target.kind === 'model'
        ? field.relationship.target.modelKey
        : (z
            .string()
            .safeParse(definition.validation.targetModelKey)
            .data?.trim() ?? '')

    return (
      <ModelReferencePicker
        label={definition.label}
        description={definition.description}
        nullable={definition.nullable}
        value={String(value)}
        onChange={onChange}
        showLabel={showLabel}
        targetModelKey={targetModelKey}
        searchReferenceRecords={searchReferenceRecords}
        resolveReferenceSnapshot={resolveReferenceSnapshot}
        sourceModelKey={sourceModelKey ?? definition.modelKey}
        relationshipRules={relationshipRules}
      />
    )
  }

  return (
    <TextField
      definition={definition}
      presentation={presentation}
      value={value}
      onChange={onChange}
      showLabel={showLabel}
      placeholder={placeholder}
    />
  )
}

/** A true/false field: one box with its label beside it. */
function CheckboxField({
  definition,
  value,
  onChange,
  showLabel,
}: {
  definition: ModelFieldDefinition
  value: string | boolean
  onChange: (value: string | boolean) => void
  showLabel: boolean
}) {
  return (
    <div
      className={`flex items-center gap-2 text-xs ${showLabel ? '' : 'justify-end'}`}
    >
      <Checkbox
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked === true)}
        aria-label={definition.label}
      />
      {showLabel ? definition.label : null}
    </div>
  )
}

/** A category field: the field's own options, plus unset when it is nullable. */
function CategorySelectField({
  definition,
  field,
  value,
  onChange,
  showLabel,
}: {
  definition: ModelFieldDefinition
  field: ReturnType<typeof definitionOfModelField>
  value: string | boolean
  onChange: (value: string | boolean) => void
  showLabel: boolean
}) {
  return (
    <label className="text-xs text-fg-muted">
      {showLabel ? definition.label : null}
      {showLabel && !definition.nullable ? ' *' : ''}
      <Select
        className={`${showLabel ? 'mt-1' : ''} h-8 text-xs`}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={definition.label}
      >
        {definition.nullable ? (
          <option value="">{t('notebook.modelFieldInput.notSet')}</option>
        ) : null}
        {selectableFieldOptions(field, value).map((option) => (
          <option key={option.id} value={option.key}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

/** The standard box: a text, number, date or date-time input with its label. */
function TextField({
  definition,
  presentation,
  value,
  onChange,
  showLabel,
  placeholder,
}: {
  definition: ModelFieldDefinition
  presentation: {
    inputType: 'number' | 'date' | 'datetime-local' | 'text' | null
    step?: '1' | 'any'
  }
  value: string | boolean
  onChange: (value: string | boolean) => void
  showLabel: boolean
  placeholder?: string
}) {
  return (
    <label className="text-xs text-fg-muted">
      {showLabel ? definition.label : null}
      {showLabel && !definition.nullable ? ' *' : ''}
      <Input
        className={`${showLabel ? 'mt-1' : ''} h-8 text-xs`}
        type={presentation.inputType ?? 'text'}
        step={presentation.step}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        aria-label={definition.label}
        placeholder={placeholder}
        required={!definition.nullable}
      />
      {showLabel && definition.description ? (
        <span className="mt-1 block text-[0.65rem]">
          {definition.description}
        </span>
      ) : null}
    </label>
  )
}

async function defaultResolveSnapshot(
  client: DataClient,
  recordId: string,
): Promise<RecordReferenceSnapshot | null> {
  const rows = await client.list<{
    id: string
    kind: string
    identifier: string
    title: string
    archived_at: string | null
    deleted_at: string | null
  }>(
    'records',
    `?id=eq.${encodeURIComponent(recordId)}&select=id,kind,identifier,title,archived_at,deleted_at`,
  )

  const row = rows.at(0)

  if (!row || row.id !== recordId) return null
  // Model key is authoritative metadata, not the storage kind: resolve it
  // through the registry, falling back to the kind when it is not visible.
  let modelKey = row.kind

  try {
    const kinds = await client.list<{ key: string }>(
      'model_kinds',
      `?record_kind=eq.${encodeURIComponent(row.kind)}&select=key`,
    )

    const key = kinds.at(0)?.key

    if (key) modelKey = key
  } catch {
    // RLS or an unmapped kind: keep the honest fallback below.
  }

  return {
    recordId: row.id,
    modelKey,
    kind: row.kind,
    identifier: row.identifier,
    title: row.title,
    archived: row.archived_at !== null,
    deleted: row.deleted_at !== null,
  }
}

/**
 * MODEL-02 Record/reference editor. Reuses the Sheet `SheetRecordPicker`
 * (Record search scoped to the relationship target) and persists the
 * stable Record UUID. Resolution states stay honest: present, archived,
 * wrong-model and missing/restricted (RLS-filtered rows read as missing).
 */
/** What the picker says about the stored reference, before and after it resolves. */
type ReferencePickerState =
  | { kind: 'invalid'; message: string }
  | { kind: 'empty' }
  | { kind: 'resolving' }
  | ReturnType<typeof resolveRecordReferenceState>

function ModelReferencePicker({
  label,
  description,
  nullable,
  value,
  onChange,
  showLabel,
  targetModelKey,
  searchReferenceRecords,
  resolveReferenceSnapshot,
  sourceModelKey,
  relationshipRules,
}: {
  label: string
  description: string | null
  nullable: boolean
  value: string
  onChange: (value: string | boolean) => void
  showLabel: boolean
  targetModelKey: string
  searchReferenceRecords?: (query: string) => Promise<SheetRecordSearchHit[]>
  resolveReferenceSnapshot?: (
    recordId: string,
  ) => Promise<RecordReferenceSnapshot | null>
  sourceModelKey?: string
  relationshipRules?: ModelRelationshipRule[]
}) {
  const [client] = useState(() => createDataClient())
  const [pickerOpen, setPickerOpen] = useState(false)

  const [snapshot, setSnapshot] = useState<
    RecordReferenceSnapshot | null | undefined
  >(undefined)

  const [identityError, setIdentityError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSnapshot(undefined)
    let persisted: string | null = null

    try {
      persisted = parsePersistedRecordReference(value, { nullable })
      setIdentityError(null)
    } catch (caught) {
      setIdentityError(
        caught instanceof RecordReferenceCellError
          ? caught.message
          : t('notebook.modelFieldInput.recordReferenceMustBe'),
      )

      return
    }

    if (persisted === null) return

    const resolve =
      resolveReferenceSnapshot ??
      ((id: string) => defaultResolveSnapshot(client, id))

    resolve(persisted)
      .then((resolved) => {
        if (!cancelled) setSnapshot(resolved)
      })
      .catch(() => {
        // Restricted rows fail closed as missing, never as present.
        if (!cancelled) setSnapshot(null)
      })

    return () => {
      cancelled = true
    }
  }, [value, nullable, client, resolveReferenceSnapshot])

  // Search is scoped to the target model on the server, so a reference to a
  // model with subtypes lists the records of every subtype.
  const search = useMemo(
    () =>
      searchReferenceRecords
        ? async (next: string): Promise<PickerSearchResult> => {
            const hits = await searchReferenceRecords(next)

            return {
              options: hits.map((h) => ({
                id: h.id,
                identifier: h.identifier,
                label: h.title,
                status: h.status ? pickerStatus(h.status) : undefined,
                disabled: h.archived,
                disabledReason: h.archived
                  ? t('notebook.modelFieldInput.archived')
                  : undefined,
              })),
              total: hits.length,
            }
          }
        : modelRecordSearch(targetModelKey),
    [searchReferenceRecords, targetModelKey],
  )

  if (!targetModelKey) {
    return (
      <div className="text-xs text-fg-muted">
        {showLabel ? label : null}
        <span className="mt-1 block text-[0.65rem] text-danger-text">
          {t('notebook.modelFieldInput.referenceTargetIsNot')}
        </span>
      </div>
    )
  }

  // MODEL-03: the source Model's declared relationships disallow this
  // target — offer nothing, say so honestly, and keep the stored value
  // untouched for a Steward to resolve.
  const targetAllowed =
    !relationshipRules ||
    !sourceModelKey ||
    isReferenceTargetAllowed(relationshipRules, sourceModelKey, targetModelKey)

  if (!targetAllowed) {
    return (
      <div className="text-xs text-fg-muted">
        {showLabel ? label : null}
        <span className="mt-1 block text-[0.65rem] text-danger-text">
          {t('notebook.modelFieldInput.sourcemodelkeyDoesNotAccept', {
            sourceModelKey,
            targetModelKey,
          })}
        </span>
      </div>
    )
  }

  const state: ReferencePickerState =
    identityError !== null
      ? { kind: 'invalid' as const, message: identityError }
      : value === ''
        ? { kind: 'empty' as const }
        : snapshot === undefined
          ? { kind: 'resolving' as const }
          : resolveRecordReferenceState({
              persistedId: value,
              snapshot,
              targetModelKey,
            })

  function handleSelect(id: string, option: PickerOption | null) {
    try {
      const persisted = selectRecordReference({
        contract: {
          format: 'sb-record-ref-v1',
          targetModelKey,
          nullable,
          cardinality: 'one',
          readOnly: false,
          writeTarget: { kind: 'model' },
        },
        // Search is scoped to the target Model server-side, so hits carry
        // the target membership by construction.
        record: {
          recordId: id,
          modelKey: targetModelKey,
          archived: option?.disabled ?? false,
          deleted: false,
        },
      })

      onChange(persisted)
    } catch (caught) {
      setIdentityError(
        caught instanceof RecordReferenceCellError
          ? caught.message
          : t('notebook.modelFieldInput.recordCannotBeSelected'),
      )
    }
  }

  return (
    <ReferenceRow
      label={label}
      description={description}
      nullable={nullable}
      value={value}
      showLabel={showLabel}
      targetModelKey={targetModelKey}
      state={state}
      search={search}
      pickerOpen={pickerOpen}
      onPickerOpenChange={setPickerOpen}
      onClear={() => {
        onChange('')
        setPickerOpen(false)
      }}
      onSelect={handleSelect}
    />
  )
}

/** The reference as the form shows it: what it reads as, and what can be done with it. */
function ReferenceRow({
  label,
  description,
  nullable,
  value,
  showLabel,
  targetModelKey,
  state,
  search,
  pickerOpen,
  onPickerOpenChange,
  onClear,
  onSelect,
}: {
  label: string
  description: string | null
  nullable: boolean
  value: string
  showLabel: boolean
  targetModelKey: string
  state: ReferencePickerState
  search: (next: string) => Promise<PickerSearchResult>
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  onClear: () => void
  onSelect: (id: string, option: PickerOption | null) => void
}) {
  return (
    <div className="text-xs text-fg-muted">
      {showLabel ? (
        <span className="font-medium">
          {label}
          {!nullable ? ' *' : ''}
        </span>
      ) : null}
      <div className={`${showLabel ? 'mt-1' : ''} space-y-1`}>
        <ReferenceStateLine
          state={state}
          nullable={nullable}
          targetModelKey={targetModelKey}
        />
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPickerOpenChange(true)}
          >
            {value === ''
              ? t('notebook.modelFieldInput.selectRecord')
              : t('notebook.modelFieldInput.changeRecord')}
          </Button>
          {value !== '' && nullable ? (
            <Button size="sm" variant="quiet" onClick={onClear}>
              {t('common.actions.clear')}
            </Button>
          ) : null}
        </div>
        <EntityPickerDialog
          open={pickerOpen}
          onOpenChange={onPickerOpenChange}
          title={t('notebook.modelFieldInput.title', {
            label: label.toLowerCase(),
          })}
          noun="record"
          search={search}
          value={value}
          onPick={(id, option) => {
            if (id) onSelect(id, option)
          }}
        />
        <span className="block text-[0.65rem]">
          {t('notebook.modelFieldInput.searchByIdOr')}
        </span>
        {showLabel && description ? (
          <span className="block text-[0.65rem]">{description}</span>
        ) : null}
      </div>
    </div>
  )
}

/** What the stored reference reads as right now: one line, or nothing to say. */
function ReferenceStateLine({
  state,
  nullable,
  targetModelKey,
}: {
  state: ReferencePickerState
  nullable: boolean
  targetModelKey: string
}) {
  switch (state.kind) {
    case 'empty':
      return (
        <span className="block text-[0.65rem]">
          {nullable
            ? t('notebook.modelFieldInput.noRecordLinked')
            : t('notebook.modelFieldInput.recordReferenceIsRequired')}
        </span>
      )
    case 'invalid':
      return (
        <span role="alert" className="block text-[0.65rem] text-danger-text">
          {state.message}
        </span>
      )
    case 'resolving':
      return (
        <span className="block text-[0.65rem]">
          {t('notebook.modelFieldInput.resolvingRecord')}
        </span>
      )
    case 'present':
      return state.snapshot ? (
        <span className="block truncate text-[0.65rem] font-medium text-fg">
          {formatRecordReferenceLabel(state.snapshot)}
        </span>
      ) : null
    case 'archived':
      return (
        <span className="block text-[0.65rem]">
          {t('notebook.modelFieldInput.recordreferencelabelArchivedTheLink', {
            recordReferenceLabel: formatRecordReferenceLabel(state.snapshot),
          })}
        </span>
      )
    case 'invalid-model':
      return (
        <span role="alert" className="block text-[0.65rem] text-danger-text">
          {t('notebook.modelFieldInput.wrongModel', {
            modelKey: state.snapshot.modelKey,
            targetModelKey,
          })}
        </span>
      )
    case 'missing':
      return (
        <span role="alert" className="block text-[0.65rem] text-danger-text">
          {t('notebook.modelFieldInput.missingRecord')}
        </span>
      )
  }
}
