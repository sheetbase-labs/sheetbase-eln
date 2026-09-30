import { useEffect, useState } from 'react'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import { definitionOfModelField } from '#/lib/model-fields'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Input } from '#/components/v3/ui/input'
import { NativeSelect } from '#/components/v3/projects/select'
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
import { SheetRecordPicker } from '#/components/sheet/sheet-record-picker'
import type { RecordPickerResult } from '#/components/scientific/record-picker'
import {
  searchSheetRecords,
  sheetRecordSearchHitsAsNotebookRecords,
} from '#/lib/sheet-record-search'
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
}: {
  definition: ModelFieldDefinition
  value: string | boolean
  onChange: (value: string | boolean) => void
  showLabel?: boolean
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
  const field = definitionOfModelField(definition)
  const presentation = fieldEditorPresentation(field.logicalType, {
    relationshipTarget: field.relationship?.target.kind,
  })

  if (presentation.kind === 'checkbox') {
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

  if (presentation.kind === 'category-select') {
    return (
      <label className="text-xs text-fg-muted">
        {showLabel ? definition.label : null}
        {showLabel && !definition.nullable ? ' *' : ''}
        <NativeSelect
          className={`${showLabel ? 'mt-1' : ''} h-8 text-xs`}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          aria-label={definition.label}
        >
          {definition.nullable ? <option value="">Not set</option> : null}
          {selectableFieldOptions(field, value).map((option) => (
            <option key={option.id} value={option.key}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </label>
    )
  }

  if (presentation.kind === 'record-picker') {
    const targetModelKey =
      field.relationship?.target.kind === 'model'
        ? field.relationship.target.modelKey
        : typeof definition.validation.targetModelKey === 'string' &&
            definition.validation.targetModelKey.trim()
          ? definition.validation.targetModelKey.trim()
          : ''
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
    if (kinds.at(0)?.key) modelKey = kinds.at(0)?.key as string
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
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SheetRecordSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<Error | null>(null)
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
          : 'Record reference must be a UUID string.',
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

  useEffect(() => {
    if (!pickerOpen) return
    setLoading(true)
    const search =
      searchReferenceRecords ??
      ((next: string) =>
        searchSheetRecords({ modelKey: targetModelKey, query: next }, client))
    const handle = setTimeout(() => {
      search(query)
        .then((hits) => {
          setResults(hits)
          setSearchError(null)
        })
        .catch((caught) => {
          setSearchError(
            caught instanceof Error ? caught : new Error('Search failed.'),
          )
        })
        .finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(handle)
  }, [pickerOpen, query, targetModelKey, client, searchReferenceRecords])

  if (!targetModelKey) {
    return (
      <label className="text-xs text-fg-muted">
        {showLabel ? label : null}
        <span className="mt-1 block text-[0.65rem] text-danger-text">
          Reference target is not configured — ask a Steward to set the
          relationship target before linking Records.
        </span>
      </label>
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
      <label className="text-xs text-fg-muted">
        {showLabel ? label : null}
        <span className="mt-1 block text-[0.65rem] text-danger-text">
          {sourceModelKey} does not accept {targetModelKey} references — ask a
          Steward to declare the relationship before linking Records.
        </span>
      </label>
    )
  }

  const state =
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

  function handleSelect(result: RecordPickerResult) {
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
          recordId: result.id,
          modelKey: targetModelKey,
          archived: result.archived,
          deleted: false,
        },
      })
      onChange(persisted)
      setPickerOpen(false)
    } catch (caught) {
      setIdentityError(
        caught instanceof RecordReferenceCellError
          ? caught.message
          : 'Record cannot be selected.',
      )
    }
  }

  return (
    <div className="text-xs text-fg-muted">
      {showLabel ? (
        <span className="font-medium">
          {label}
          {!nullable ? ' *' : ''}
        </span>
      ) : null}
      <div className={`${showLabel ? 'mt-1' : ''} space-y-1`}>
        {state.kind === 'empty' ? (
          <span className="block text-[0.65rem]">
            {nullable ? 'No Record linked.' : 'Record reference is required.'}
          </span>
        ) : null}
        {state.kind === 'invalid' ? (
          <span role="alert" className="block text-[0.65rem] text-danger-text">
            {state.message}
          </span>
        ) : null}
        {state.kind === 'resolving' ? (
          <span className="block text-[0.65rem]">Resolving Record…</span>
        ) : null}
        {state.kind === 'present' && state.snapshot ? (
          <span className="block truncate text-[0.65rem] font-medium text-fg">
            {formatRecordReferenceLabel(state.snapshot)}
          </span>
        ) : null}
        {state.kind === 'archived' ? (
          <span className="block text-[0.65rem]">
            {formatRecordReferenceLabel(state.snapshot)} · archived — the link
            persists, archived Records stay read-only history.
          </span>
        ) : null}
        {state.kind === 'invalid-model' ? (
          <span role="alert" className="block text-[0.65rem] text-danger-text">
            Belongs to model {state.snapshot.modelKey}, expected{' '}
            {targetModelKey} — pick a {targetModelKey} Record.
          </span>
        ) : null}
        {state.kind === 'missing' ? (
          <span role="alert" className="block text-[0.65rem] text-danger-text">
            Record {state.recordId} is not found or not visible in this
            workspace — the stored UUID is kept, pick a replacement or clear it.
          </span>
        ) : null}
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPickerOpen((open) => !open)}
          >
            {value === '' ? 'Select record' : 'Change record'}
          </Button>
          {value !== '' && nullable ? (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                onChange('')
                setPickerOpen(false)
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
        {pickerOpen ? (
          <div className="overflow-hidden rounded-md border">
            <SheetRecordPicker
              modelKey={targetModelKey}
              // Display-only projection: the picker never changes stored
              // state, selection persists the Record UUID.
              results={sheetRecordSearchHitsAsNotebookRecords(results, '')}
              loading={loading}
              error={searchError}
              onSearch={setQuery}
              onSelect={handleSelect}
              selectedId={value === '' ? null : value}
            />
          </div>
        ) : null}
        <span className="block text-[0.65rem]">
          Selection persists the Record UUID. Record ID and Name are display
          only.
        </span>
        {showLabel && description ? (
          <span className="block text-[0.65rem]">{description}</span>
        ) : null}
      </div>
    </div>
  )
}
