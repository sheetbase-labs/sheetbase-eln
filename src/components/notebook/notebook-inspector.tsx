import { t } from '#/copy'
import * as React from 'react'
import { Link } from '@tanstack/react-router'

import {
  EmptyHint,
  InspectorSection,
  InspectorSectionStack,
} from '#/components/record'
import { getDisplayTimeZone } from '#/lib/display-time-zone'
import { formatMagnitude } from '#/lib/format-numbers'
import { Notice } from '#/components/v3/ui/alert'
import { TabsRoot, TabsList, TabsPanel, TabsTab } from '#/components/v3/ui/tabs'
import { cn } from '#/lib/utils'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { FieldDefinition } from '#/lib/field-definition'
import type { BoundValueState } from '#/lib/sheet-bound-columns'

/**
 * EXP-04.4 — the Notebook inspector tabs. The right-hand panel switches
 * between Properties (the selected cell), Comments and History. It is
 * presentational: it renders the facts it is given and names the facts it does
 * not have, so a missing instrument, capture or edit record reads as
 * unavailable rather than as a blank placeholder.
 *
 * Properties content is built from facts that already exist (the sheet
 * column's `FieldDefinition`, the bound value and its `BoundValueState`
 * provenance). Comments and History are supplied by the route so it can reuse
 * the existing `CommentPanel`/`ThreadPanel` (block and row threads) and
 * `NotebookHistoryPanel` (record history) unchanged.
 */

export type NotebookInspectorTab = 'properties' | 'comments' | 'history'

export interface NotebookInspectorCellValue {
  /** Formatted display text of the stored value; `null` when none is stored. */
  display: string | null
  unit?: string | null
  /** Honest note when the value could not be resolved or formatted. */
  note?: string | null
}

export type NotebookInspectorValidationState =
  'valid' | 'warning' | 'error' | 'unknown'

export interface NotebookInspectorCellValidation {
  state: NotebookInspectorValidationState
  headline?: string | null
  detail?: string | null
  /** The rule the value was measured against, when one is known. */
  rule?: string | null
}

export interface NotebookInspectorProvenance {
  dataset?: {
    label: string
    /** Stable-UUID route target; the label is shown as-is. */
    datasetId?: string | null
    rowLabel?: string | null
  } | null
  instrument?: string | null
  capturedAt?: string | null
  enteredBy?: string | null
  editedAt?: string | null
}

export interface NotebookInspectorColumn {
  field?: string | null
  type?: string | null
  unit?: string | null
  validation?: string | null
  required?: boolean | null
  source?: string | null
}

export interface NotebookInspectorCellFacts {
  /** Dotted context line, e.g. "Clarification runs · row 9 · Turbidity out". */
  subject?: string | null
  value: NotebookInspectorCellValue
  validation?: NotebookInspectorCellValidation | null
  provenance?: NotebookInspectorProvenance | null
  column?: NotebookInspectorColumn | null
}

const NOT_AVAILABLE = t('notebook.notebookInspector.notAvailable')

const FIELD_TYPE_LABEL: Record<FieldDefinition['logicalType'], string> = {
  text: t('notebook.notebookInspector.text'),
  integer: t('notebook.notebookInspector.integer'),
  decimal: t('notebook.notebookInspector.decimal'),
  boolean: t('notebook.notebookInspector.boolean'),
  date: t('notebook.notebookInspector.date'),
  timestamp: t('notebook.notebookInspector.timestamp'),
  category: t('notebook.notebookInspector.category'),
  reference: t('notebook.notebookInspector.reference'),
}

/** Format a stored field value for the inspector; `null` when empty. */
export function formatCellValue(
  value: unknown,
  field: FieldDefinition | null,
): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean')
    return value ? t('notebook.notebookInspector.yes') : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  if (field?.logicalType === 'decimal' || field?.logicalType === 'integer') {
    const magnitude = formatMagnitude(value)
    if (magnitude) return magnitude
  }
  if (field?.logicalType === 'timestamp' || field?.logicalType === 'date') {
    const parsed = new Date(String(value))
    if (!Number.isNaN(parsed.getTime())) {
      return field.logicalType === 'date'
        ? parsed.toLocaleDateString(undefined, {
            timeZone: getDisplayTimeZone(),
          })
        : parsed.toLocaleString(undefined, { timeZone: getDisplayTimeZone() })
    }
  }
  return String(value)
}

/** The field's own unit, preferring the display unit where one is configured. */
function fieldUnit(field: FieldDefinition | null): string | null {
  // The guard is what narrows `field` to a definition, so the optional chain stays.
  if (!field?.quantity) return null
  // `storageUnit` is required, so the fallback chain always resolves to a string.
  return field.quantity.preferredDisplayUnit ?? field.quantity.storageUnit
}

/** A one-line description of a field's validation rule, when it has one. */
export function fieldValidationRule(
  field: FieldDefinition | null,
): string | null {
  if (!field) return null
  const { min, max, minLength, maxLength, pattern } = field.validation
  if (min !== undefined && max !== undefined)
    return t('notebook.notebookInspector.allowedMinMax', { min, max })
  if (min !== undefined)
    return t('notebook.notebookInspector.atLeastMin', { min })
  if (max !== undefined)
    return t('notebook.notebookInspector.atMostMax', { max })
  if (minLength !== undefined && maxLength !== undefined) {
    return t('notebook.notebookInspector.minlengthMaxlengthCharacters', {
      minLength,
      maxLength,
    })
  }
  if (pattern) return t('notebook.notebookInspector.mustMatchAPattern')
  return null
}

/** Evaluate a numeric field's bounds against the value, when it can. */
function evaluateValidation(
  field: FieldDefinition | null,
  value: unknown,
): NotebookInspectorCellValidation | null {
  const rule = fieldValidationRule(field)
  if (!field || !rule) return null
  const { min, max } = field.validation
  const numeric =
    typeof value === 'number'
      ? value
      : value === null || value === undefined || value === ''
        ? null
        : Number(value)
  if (
    numeric === null ||
    Number.isNaN(numeric) ||
    (min === undefined && max === undefined)
  ) {
    return { state: 'unknown', rule }
  }
  if (min !== undefined && numeric < min) {
    return {
      state: 'error',
      headline: t('notebook.notebookInspector.belowTheAllowedRange'),
      detail: `${rule}.`,
      rule,
    }
  }
  if (max !== undefined && numeric > max) {
    return {
      state: 'error',
      headline: t('notebook.notebookInspector.aboveTheAllowedRange'),
      detail: `${rule}.`,
      rule,
    }
  }
  return {
    state: 'valid',
    headline: t('notebook.notebookInspector.withinTheAllowedRange'),
    rule,
  }
}

/** Map a bound value's provenance to the inspector's provenance facts. */
function provenanceFacts(
  valueState: BoundValueState | null,
): NotebookInspectorProvenance | null {
  if (!valueState) return null
  const provenance = valueState.provenance
  if (provenance.sourceKind === 'dataset') {
    return {
      dataset: {
        label: provenance.sourceDatasetId,
        datasetId: provenance.sourceDatasetId,
        rowLabel: provenance.sourceRowId,
      },
      instrument: null,
      capturedAt: null,
      enteredBy: null,
      editedAt: null,
    }
  }
  return {
    dataset: {
      label: provenance.sourceRecordId,
      rowLabel: provenance.sourceFieldName,
    },
    instrument: null,
    capturedAt: null,
    enteredBy: null,
    editedAt: null,
  }
}

/**
 * Build Properties facts for a selected canonical sheet cell from data that
 * already exists. Uses the bound value/provenance when the Sheet is composed
 * and the column's field definition for validation and the column section.
 * Facts the model does not carry (instrument, capture time, entry and edit
 * actors) are left absent so the panel names them as unavailable.
 */
export function canonicalCellFacts(input: {
  column: CanonicalSheetGridColumn | null
  /** The resolved cell value (matrix value or bound value). */
  value: unknown
  /** Bound provenance for the selected row/cell, when the Sheet is composed. */
  valueState?: BoundValueState | null
  rowLabel?: string | null
  blockLabel?: string | null
}): NotebookInspectorCellFacts {
  const { column } = input
  const field = column?.field ?? null
  const context = [input.blockLabel, input.rowLabel, column?.label].filter(
    (part): part is string => Boolean(part),
  )
  const validation = evaluateValidation(field, input.value)
  const rule = fieldValidationRule(field)
  return {
    subject: context.length > 0 ? context.join(' · ') : null,
    value: {
      display: formatCellValue(input.value, field),
      unit: fieldUnit(field),
    },
    validation,
    provenance: provenanceFacts(input.valueState ?? null),
    column: column
      ? {
          field: column.label,
          type: FIELD_TYPE_LABEL[field?.logicalType ?? 'text'],
          unit: fieldUnit(field),
          validation: rule,
          required: field ? !field.nullable : null,
          source:
            column.origin === 'bound'
              ? t('notebook.notebookInspector.linked')
              : column.origin,
        }
      : null,
  }
}

function FactRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn(value == null && 'text-fg-muted')}>
        {value ?? NOT_AVAILABLE}
      </dd>
    </div>
  )
}

function ProvenanceSection({
  provenance,
}: {
  provenance: NotebookInspectorProvenance | null
}) {
  if (!provenance) {
    return (
      <InspectorSection title={t('notebook.notebookInspector.title')}>
        <EmptyHint>
          {t('notebook.notebookInspector.provenanceIsNotAvailable')}
        </EmptyHint>
      </InspectorSection>
    )
  }
  const dataset = provenance.dataset
  return (
    <InspectorSection title={t('notebook.notebookInspector.title')}>
      <dl className="space-y-1.5">
        <FactRow
          label={t('notebook.notebookInspector.label')}
          value={
            dataset ? (
              <>
                {dataset.datasetId ? (
                  <Link
                    to="/datasets"
                    search={{ dataset: dataset.datasetId } as never}
                    className="underline underline-offset-2 hover:text-fg"
                  >
                    {dataset.label}
                  </Link>
                ) : (
                  dataset.label
                )}
                {dataset.rowLabel
                  ? ` ${t('notebook.notebookInspector.rowLabel', { label: dataset.rowLabel })}`
                  : null}
              </>
            ) : undefined
          }
        />
        <FactRow
          label={t('notebook.notebookInspector.instrumentLabel')}
          value={provenance.instrument ?? undefined}
        />
        <FactRow
          label={t('notebook.notebookInspector.capturedLabel')}
          value={provenance.capturedAt ?? undefined}
        />
        <FactRow
          label={t('notebook.notebookInspector.enteredByLabel')}
          value={provenance.enteredBy ?? undefined}
        />
        <FactRow
          label={t('notebook.notebookInspector.editedLabel')}
          value={provenance.editedAt ?? undefined}
        />
      </dl>
    </InspectorSection>
  )
}

function ColumnSection({ column }: { column: NotebookInspectorColumn | null }) {
  if (!column) {
    return (
      <InspectorSection title={t('notebook.notebookInspector.columnTitle')}>
        <EmptyHint>{t('notebook.notebookInspector.thisCellHasNo')}</EmptyHint>
      </InspectorSection>
    )
  }
  return (
    <InspectorSection title={t('notebook.notebookInspector.columnTitle')}>
      <dl className="space-y-1.5">
        <FactRow
          label={t('notebook.notebookInspector.fieldLabel')}
          value={column.field ?? undefined}
        />
        <FactRow
          label={t('notebook.notebookInspector.typeLabel')}
          value={column.type ?? undefined}
        />
        <FactRow
          label={t('notebook.notebookInspector.unitLabel')}
          value={column.unit ?? undefined}
        />
        <FactRow
          label={t('notebook.notebookInspector.validationLabel')}
          value={column.validation ?? undefined}
        />
        <FactRow
          label={t('common.states.required')}
          value={
            column.required === null || column.required === undefined
              ? undefined
              : column.required
                ? t('notebook.notebookInspector.yes')
                : 'No'
          }
        />
        <FactRow
          label={t('notebook.notebookInspector.sourceLabel')}
          value={column.source ?? undefined}
        />
      </dl>
    </InspectorSection>
  )
}

function ValidationSection({
  validation,
  actions,
}: {
  validation: NotebookInspectorCellValidation | null
  actions?: React.ReactNode
}) {
  // The v3 Notice carries info/warn/bad only: a valid or unevaluated cell keeps
  // the neutral info wash and the headline names the state.
  const tone =
    validation?.state === 'error'
      ? 'bad'
      : validation?.state === 'warning'
        ? 'warn'
        : 'info'
  return (
    <InspectorSection title={t('notebook.notebookInspector.validationLabel')}>
      {validation ? (
        <Notice
          tone={tone}
          title={
            validation.headline ??
            (validation.state === 'valid'
              ? t('notebook.notebookInspector.validTitle')
              : validation.state === 'unknown'
                ? t('notebook.notebookInspector.validationNotEvaluatedTitle')
                : t('notebook.notebookInspector.validationIssueTitle'))
          }
        >
          {validation.detail
            ? validation.detail
            : validation.rule
              ? validation.rule
              : null}
        </Notice>
      ) : (
        <EmptyHint>
          {t('notebook.notebookInspector.noValidationRuleIs')}
        </EmptyHint>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {actions ?? (
          <EmptyHint>
            {t('notebook.notebookInspector.noActionsAreAvailable')}
          </EmptyHint>
        )}
      </div>
    </InspectorSection>
  )
}

/** The Properties tab — the selected cell's value, validation, provenance and column. */
export function NotebookCellProperties({
  cell,
  actions,
}: {
  cell: NotebookInspectorCellFacts | null
  actions?: React.ReactNode
}) {
  if (!cell) {
    return (
      <EmptyHint>
        {t('notebook.notebookInspector.nothingIsSelectedChoose')}
      </EmptyHint>
    )
  }
  return (
    <InspectorSectionStack>
      <InspectorSection
        title={t('notebook.notebookInspector.selectedCellTitle')}
      >
        {cell.subject ? (
          <p className="mb-1 text-xs text-fg-muted">{cell.subject}</p>
        ) : null}
        <p className="text-lg font-medium">
          {cell.value.display ?? (
            <span className="text-fg-muted">
              {t('notebook.notebookInspector.noValueRecorded')}
            </span>
          )}
          {cell.value.display && cell.value.unit ? (
            <span className="ml-1 text-xs font-normal text-fg-muted">
              {cell.value.unit}
            </span>
          ) : null}
        </p>
        {cell.value.note ? (
          <p className="mt-1 text-xs text-fg-muted">{cell.value.note}</p>
        ) : null}
      </InspectorSection>
      <ValidationSection
        validation={cell.validation ?? null}
        actions={actions}
      />
      <ProvenanceSection provenance={cell.provenance ?? null} />
      <ColumnSection column={cell.column ?? null} />
    </InspectorSectionStack>
  )
}

export interface NotebookInspectorProps {
  /** Selected-cell facts for the Properties tab; `null` when nothing is selected. */
  cell?: NotebookInspectorCellFacts | null
  /** Validation actions (for example the dataset `ValueActions`). */
  actions?: React.ReactNode
  /** Comments content — reuse `CommentPanel`/`ThreadPanel` (block and row threads). */
  comments?: React.ReactNode
  /** History content — reuse `NotebookHistoryPanel` (record history). */
  history?: React.ReactNode
  commentsCount?: number
  historyCount?: number
  defaultTab?: NotebookInspectorTab
  className?: string
}

export function NotebookInspector({
  cell = null,
  actions,
  comments,
  history,
  commentsCount,
  historyCount,
  defaultTab = 'properties',
  className,
}: NotebookInspectorProps) {
  return (
    <div
      aria-label={t('notebook.notebookInspector.ariaLabel')}
      className={cn('flex flex-col', className)}
    >
      <TabsRoot defaultValue={defaultTab} className="flex flex-col gap-0">
        <div className="border-b border-border px-2">
          <TabsList variant="fit" className="h-auto w-full">
            <TabsTab variant="fit" value="properties">
              {t('notebook.notebookInspector.properties')}
            </TabsTab>
            <TabsTab variant="fit" value="comments">
              {t('notebook.notebookInspector.comments')}
              {commentsCount !== undefined ? (
                <span className="num text-label text-fg-muted">
                  {commentsCount}
                </span>
              ) : null}
            </TabsTab>
            <TabsTab variant="fit" value="history">
              {t('notebook.notebookInspector.history')}
              {historyCount !== undefined ? (
                <span className="num text-label text-fg-muted">
                  {historyCount}
                </span>
              ) : null}
            </TabsTab>
          </TabsList>
        </div>
        <TabsPanel value="properties" className="px-4 py-4">
          <NotebookCellProperties cell={cell} actions={actions} />
        </TabsPanel>
        <TabsPanel value="comments" className="px-4 py-4">
          {comments ?? (
            <EmptyHint>
              {t('notebook.notebookInspector.commentsAreNotAvailable')}
            </EmptyHint>
          )}
        </TabsPanel>
        <TabsPanel value="history" className="px-4 py-4">
          {history ?? (
            <EmptyHint>
              {t('notebook.notebookInspector.historyIsNotAvailable')}
            </EmptyHint>
          )}
        </TabsPanel>
      </TabsRoot>
    </div>
  )
}
