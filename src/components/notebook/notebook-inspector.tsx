import { t } from '#/copy'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  EmptyHint,
  InspectorSection,
  InspectorSectionStack,
} from '#/components/record'
import { Notice } from '#/components/ui/alert'
import { ObjectLink } from '#/components/ui/object-link'
import { fetchDatasetLinkTargets } from '#/lib/dataset-link-targets'
import { notebookDataClient } from '#/lib/notebook-data'
import { OverflowTabs } from '#/components/ui/overflow-tabs'
import { TabsRoot, TabsPanel } from '#/components/ui/tabs'
import { cn } from '#/lib/utils'

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

function FactRow({ label, value }: { label: string; value?: React.ReactNode }) {
  // A fact nobody recorded isn't worth a row of "Not available".
  if (value == null) return null

  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-fg-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function ProvenanceSection({
  provenance,
}: {
  provenance: NotebookInspectorProvenance | null
}) {
  const known =
    provenance &&
    (provenance.dataset ||
      provenance.instrument ||
      provenance.capturedAt ||
      provenance.enteredBy ||
      provenance.editedAt)

  if (!provenance || !known) {
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
          value={dataset ? <SourceFact dataset={dataset} /> : undefined}
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

// Notice has no success tone. Valid and unevaluated values remain neutral;
// their headlines distinguish the states without inventing a validation result.
const VALIDATION_PRESENTATION = {
  valid: {
    tone: 'info',
    title: t('notebook.notebookInspector.validTitle'),
  },
  unknown: {
    tone: 'info',
    title: t('notebook.notebookInspector.validationNotEvaluatedTitle'),
  },
  warning: {
    tone: 'warn',
    title: t('notebook.notebookInspector.validationIssueTitle'),
  },
  error: {
    tone: 'bad',
    title: t('notebook.notebookInspector.validationIssueTitle'),
  },
} satisfies Record<
  NotebookInspectorValidationState,
  { tone: React.ComponentProps<typeof Notice>['tone']; title: string }
>

function ValidationSection({
  validation,
  actions,
}: {
  validation: NotebookInspectorCellValidation | null
  actions?: React.ReactNode
}) {
  // A cell with no rule and nothing to do has nothing to say here.
  if (!validation && !actions) return null
  const presentation = VALIDATION_PRESENTATION[validation?.state ?? 'unknown']

  return (
    <InspectorSection title={t('notebook.notebookInspector.validationLabel')}>
      {validation ? (
        <Notice
          tone={presentation.tone}
          title={validation.headline ?? presentation.title}
        >
          {validation.detail || validation.rule || null}
        </Notice>
      ) : null}
      {actions ? (
        <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
      ) : null}
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
  const [activeTab, setActiveTab] =
    React.useState<NotebookInspectorTab>(defaultTab)

  return (
    <div
      aria-label={t('notebook.notebookInspector.ariaLabel')}
      className={cn('flex flex-col', className)}
    >
      <TabsRoot
        value={activeTab}
        onValueChange={(next) =>
          setActiveTab(
            z.enum(['properties', 'comments', 'history']).parse(next),
          )
        }
        className="flex flex-col gap-0"
      >
        <div className="flex border-b border-border px-4">
          <OverflowTabs
            items={[
              {
                value: 'properties',
                label: t('notebook.notebookInspector.properties'),
              },
              {
                value: 'comments',
                label: t('notebook.notebookInspector.comments'),
                count: commentsCount,
              },
              {
                value: 'history',
                label: t('notebook.notebookInspector.history'),
                count: historyCount,
              },
            ]}
            value={activeTab}
            onValueChange={(next) =>
              setActiveTab(
                z.enum(['properties', 'comments', 'history']).parse(next),
              )
            }
          />
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

/** Where a cell's value comes from: a dataset as a link, else its label. */
function SourceFact({
  dataset,
}: {
  dataset: NonNullable<NotebookInspectorProvenance['dataset']>
}) {
  if (dataset.datasetId)
    return (
      <DatasetSource
        datasetId={dataset.datasetId}
        label={dataset.label}
        rowLabel={dataset.rowLabel ?? null}
      />
    )

  return (
    <>
      {dataset.label}
      {dataset.rowLabel
        ? ` ${t('notebook.notebookInspector.rowLabel', { label: dataset.rowLabel })}`
        : null}
    </>
  )
}

/** The dataset a bound cell comes from, named the way people know it: its
 * DS- number as a link and its name. An internal row key is never shown. */
function DatasetSource({
  datasetId,
  label,
  rowLabel,
}: {
  datasetId: string
  label: string
  rowLabel: string | null
}) {
  const target = useQuery({
    queryKey: ['dataset-link-target', datasetId],
    queryFn: async () =>
      (await fetchDatasetLinkTargets(notebookDataClient, [datasetId])).get(
        datasetId,
      ) ?? null,
  })

  const dataset = target.data
  const internal = (text: string) => UUID.test(text)
  const identifier = dataset?.display_id ?? (internal(label) ? null : label)

  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5">
      <ObjectLink kind="dataset" id={datasetId} identifier={identifier}>
        {identifier ? undefined : t('notebook.notebookInspector.datasetSource')}
      </ObjectLink>
      {dataset ? <span className="text-fg-muted">{dataset.name}</span> : null}
      {rowLabel && !internal(rowLabel) ? (
        <span>
          {t('notebook.notebookInspector.rowLabel', { label: rowLabel })}
        </span>
      ) : null}
    </span>
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
