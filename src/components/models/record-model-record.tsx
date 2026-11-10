import { useFieldPluginTypes } from '#/components/extensions/table-hooks'
import { PluginScreen } from '#/components/extensions/plugin-screen'
import {
  operationAccess,
  usePluginPoints,
} from '#/components/extensions/use-plugin-points'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { DescriptionList, PageHeader, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { SpecVerdictBadge } from '#/components/results/spec-verdict'
import { describeLimits, useRecordQuality } from '#/lib/result-quality'
import { RecordHistoryTimeline } from '#/components/audit/record-history-timeline'
import { pickerStatus } from '#/components/record-picker/record-picker-data'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { typeForVersion } from '#/lib/model-subtypes'
import { useModelTypes, useTypeFields } from './model-subtype-data'
import { displayModelFieldValue, modelFieldValueText } from '#/lib/model-fields'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import {
  laterAddedModelFields,
  recordFieldValue,
  useRecordModelFields,
  useRecordModelRecord,
  useRecordModelTimeline,
  useRecordModelUsedBy,
  useWorkspaceRecordModel,
} from './models-data'
import { RecordModelEditDialog } from './record-model-edit-dialog'
import { rich, t } from '#/copy'
import { hasCapability } from '#/lib/capability'
import {
  RegistryLineage,
  RegistryRetireButton,
} from '#/components/registry/registry-lineage'

/** The record's fields grouped by the section the model puts them in, in the
 * order the sections first appear; fields with no section follow, unnamed. */
function fieldSections(fields: ModelFieldDefinition[]) {
  const groups = new Map<string, ModelFieldDefinition[]>()

  for (const field of fields) {
    const name = field.section ?? ''
    groups.set(name, [...(groups.get(name) ?? []), field])
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0))
    .map(([name, grouped]) => ({ name, fields: grouped }))
}

/**
 * MDL-04.3 — a record page for a workspace model: the model's fields as a
 * details list, a banner for fields the model gained after this record was
 * created, who uses the record, the canonical record timeline, and the
 * integrations note. Everything is read from the model and the record; no
 * per-model page code.
 *
 * MOB-02.4: the fields already read as one column, so on a phone the page just
 * moves its actions to the end of that column as full-width targets
 * (`canvas/RecordPhone.dc.html`); the desktop header keeps them.
 */
function usePinnedFields(
  modelKey: string,
  versionId: string | null | undefined,
) {
  // A record given a subtype pins the subtype's version and carries every
  // field from this model down to it.
  const types = useModelTypes()

  const pinnedType = typeForVersion(types.data ?? [], versionId)

  const subtype = pinnedType && pinnedType.key !== modelKey ? pinnedType : null

  const ownFields = useRecordModelFields(
    versionId && !subtype && !types.isLoading ? modelKey : '',
    notebookDataClient,
    versionId ?? undefined,
  )

  const chainFields = useTypeFields(
    types.data,
    modelKey,
    subtype?.key ?? null,
    versionId ?? null,
    { enabled: Boolean(subtype) },
  )

  const fieldsQuery = subtype
    ? {
        data: chainFields.data?.flatMap((group) => group.fields),
        isError: chainFields.isError,
        isLoading: chainFields.isLoading,
      }
    : {
        data: ownFields.data,
        isError: ownFields.isError,
        isLoading: ownFields.isLoading || types.isLoading,
      }

  return { subtype, fieldsQuery }
}

function useRecordPage({
  modelKey,
  recordId,
  role,
}: {
  modelKey: string
  recordId: string
  role?: string | null
}) {
  const model = useWorkspaceRecordModel(modelKey)
  const recordQuery = useRecordModelRecord(recordId)

  const { subtype, fieldsQuery } = usePinnedFields(
    modelKey,
    recordQuery.data?.model_version_id,
  )

  const usedByQuery = useRecordModelUsedBy(recordId)
  const quality = useRecordQuality(model.data?.workspace_id, modelKey, recordId)
  const timelineQuery = useRecordModelTimeline(recordId)
  const pluginPoints = usePluginPoints()
  const fieldTypeLinks = useFieldPluginTypes(modelKey)

  const [editing, setEditing] = useState(false)
  const fields = fieldsQuery.data ?? []
  const record = recordQuery.data
  const usedBy = usedByQuery.data ?? []
  const timeline = timelineQuery.data ?? []

  const laterFields = record ? laterAddedModelFields(fields, record) : []
  const results = quality.results
  const resultByField = new Map(results.map((r) => [r.fieldName, r] as const))
  const limitsByField = quality.limitsByField

  const labelOf = (fieldName: string) =>
    fields.find((f) => f.fieldName === fieldName)?.label ?? fieldName

  const failing = results.filter((r) => r.verdict === 'fail')
  const alerting = results.filter((r) => r.verdict === 'alert')
  const status = record ? pickerStatus(record.status) : null
  const isRegistry = Boolean(model.data?.is_registry)
  // A field with a plugin's type, where that plugin also has a panel for this
  // model, is shown by the panel; the plain list would only show its raw value.

  const shownByPanel = new Set(
    (fieldTypeLinks.data ?? [])
      .filter((link) =>
        pluginPoints.panels.some(
          (panel) =>
            panel.extensionKey === link.plugin_key &&
            (!panel.declaration.models ||
              panel.declaration.models.includes(modelKey)),
        ),
      )
      .map((link) => link.field_name),
  )

  const canWrite = hasCapability(role, 'record.create')

  return {
    modelKey,
    model,
    recordQuery,
    fieldsQuery,
    fields,
    record,
    subtype,
    quality,
    usedBy,
    timeline,
    timelineQuery,
    pluginPoints,
    editing,
    setEditing,
    laterFields,
    resultByField,
    limitsByField,
    labelOf,
    failing,
    alerting,
    status,
    isRegistry,
    shownByPanel,
    canWrite,
  }
}

type RecordPage = ReturnType<typeof useRecordPage>

export function RecordModelRecord(props: {
  modelKey: string
  recordId: string
  role?: string | null
}) {
  const page = useRecordPage(props)
  const { modelKey, recordQuery, record } = page

  if (!recordQuery.isLoading && (!record || record.kind !== modelKey)) {
    return (
      <div className="px-4 py-6 md:px-6">
        <EmptyState
          icon="table"
          title={t('library.models.recordModelRecord.recordNotFound')}
          description={t(
            'library.models.recordModelRecord.thisRecordIsNotVisible',
          )}
          action={
            <Button
              variant="primary"
              nativeButton={false}
              render={
                <Link
                  to="/models/$modelId/records"
                  params={{ modelId: modelKey }}
                />
              }
            >
              {t('library.models.recordModelRecord.backToRecords')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <RecordHeader page={page} />
      <RecordBody page={page} />
    </div>
  )
}

function RecordHeader({ page }: { page: RecordPage }) {
  const {
    modelKey,
    model,
    record,
    status,
    isRegistry,
    canWrite,
    fieldsQuery,
    setEditing,
  } = page

  return (
    <PageHeader
      trail={[
        {
          label: model.data?.name ?? modelKey,
          link: {
            to: '/models/$modelId/records',
            params: { modelId: modelKey },
          },
        },
        { label: record?.identifier ?? '…', mono: true },
      ]}
      title={record?.title ?? t('library.models.recordModelRecord.record')}
      meta={
        record ? (
          <>
            {status ? (
              <span className="text-fg">
                <Status tone={status.tone}>{status.label}</Status>
              </span>
            ) : null}
            <span>{model.data?.name ?? modelKey}</span>
          </>
        ) : (
          <span>{t('library.models.recordModelRecord.loadingRecord')}</span>
        )
      }
      actions={
        <div className="flex gap-2 max-md:hidden">
          {isRegistry && record && canWrite ? (
            <RegistryRetireButton
              recordId={record.id}
              identifier={record.identifier}
              retired={Boolean(record.archived_at)}
              metadataVersion={record.metadata_version ?? 1}
            />
          ) : null}
          {record?.model_version_id &&
          !fieldsQuery.isError &&
          !fieldsQuery.isLoading ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('library.models.recordModelRecord.editDetails')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            nativeButton={false}
            render={
              <Link
                to="/models/$modelId/records"
                params={{ modelId: modelKey }}
              />
            }
          >
            {t('library.models.recordModelRecord.allRecords')}
          </Button>
          <Button
            variant="primary"
            nativeButton={false}
            render={
              <Link
                to="/models/$modelId/records/new"
                params={{ modelId: modelKey }}
              />
            }
          >
            {t('common.actions.new')} {model.data?.name ?? 'record'}
          </Button>
        </div>
      }
    />
  )
}

function RecordBody({ page }: { page: RecordPage }) {
  const {
    modelKey,
    record,
    quality,
    failing,
    alerting,
    labelOf,
    laterFields,
    isRegistry,
    editing,
    setEditing,
    fields,
  } = page

  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 py-4 md:px-6">
      {isRegistry && record?.archived_at ? (
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-label">
          {t('registry.entry.retiredBanner')}
        </div>
      ) : null}
      {quality.onHold ? (
        <div
          role="status"
          className="rounded-md border border-border bg-surface-muted px-3 py-2 text-label"
        >
          {t('quality.retention.recordBanner')}
        </div>
      ) : null}
      {failing.length ? (
        <div
          role="status"
          className="rounded-md border border-danger bg-surface-muted px-3 py-2 text-label"
        >
          {t('quality.limits.outOfSpecBanner', {
            fields: failing.map((r) => labelOf(r.fieldName)).join(', '),
          })}
        </div>
      ) : alerting.length ? (
        <div
          role="status"
          className="rounded-md border border-border bg-surface-muted px-3 py-2 text-label"
        >
          {t('quality.limits.alertBanner', {
            fields: alerting.map((r) => labelOf(r.fieldName)).join(', '),
          })}
        </div>
      ) : null}
      {laterFields.length ? (
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-label">
          {rich('library.models.recordModelRecord.addedToThisModelLater', {
            fields: laterFields.map((field) => field.label).join(', '),
            span: (text) => <span className="font-medium">{text}</span>,
          })}
        </div>
      ) : null}

      <RecordDetails page={page} />

      {record && editing ? (
        <RecordModelEditDialog
          open
          onOpenChange={setEditing}
          recordId={record.id}
          modelKey={modelKey}
          fields={fields.filter((field) => field.lifecycle === 'active')}
          stored={record.custom_fields}
        />
      ) : null}

      <RecordPanels page={page} />
      <RecordRelated page={page} />
    </div>
  )
}

function RecordDetails({ page }: { page: RecordPage }) {
  const { record, fieldsQuery } = page

  return (
    <Section title={t('library.models.recordModelRecord.details')}>
      {record && !record.model_version_id ? (
        <p role="status" className="text-label text-fg-muted">
          {t('library.models.recordModelRecord.thisLegacyRecordHasNo')}
        </p>
      ) : null}
      {fieldsQuery.isError ? (
        <p role="alert">
          {t('library.models.recordModelRecord.theRecordsModelVersionIs')}
        </p>
      ) : record && !fieldsQuery.isLoading ? (
        <RecordDetailValues page={page} record={record} />
      ) : (
        <p className="text-label text-fg-muted">
          {t('library.models.recordModelRecord.loadingFields')}
        </p>
      )}
    </Section>
  )
}

function RecordDetailValues({
  page,
  record,
}: {
  page: RecordPage
  record: NonNullable<RecordPage['record']>
}) {
  const {
    subtype,
    status,
    fields,
    shownByPanel,
    resultByField,
    limitsByField,
  } = page

  return (
    <div className="grid items-start gap-x-10 gap-y-5 md:grid-cols-2">
      <DescriptionList
        items={[
          [
            'ID',
            <span key="identifier" className="mono">
              {record.identifier}
            </span>,
          ],
          [t('library.models.recordModelRecord.name'), record.title],
          ...(subtype
            ? [
                [
                  t('library.models.recordModelRecord.type'),
                  subtype.name,
                ] satisfies [React.ReactNode, React.ReactNode],
              ]
            : []),
          [
            t('library.models.recordModelRecord.status'),
            status ? status.label : record.status,
          ],
          [
            t('library.models.recordModelRecord.created'),
            formatDate(record.created_at),
          ],
          ...(!record.model_version_id
            ? Object.entries(record.custom_fields ?? {}).map<
                [React.ReactNode, React.ReactNode]
              >(([key, value]) => [
                key,
                value == null ? '—' : modelFieldValueText(value),
              ])
            : []),
        ]}
      />
      {fieldSections(fields.filter((f) => !shownByPanel.has(f.fieldName))).map(
        (group) => (
          <div key={group.name} className="min-w-0">
            {group.name ? (
              <h3 className="m-0 mb-1.5 font-sans text-label font-semibold">
                {group.name}
              </h3>
            ) : null}
            <DescriptionList
              items={group.fields.map<[React.ReactNode, React.ReactNode]>(
                (field) => {
                  // A date-typed field stores an ISO date; show it in the
                  // same short form as the record's own metadata.
                  const raw = recordFieldValue(record, field.fieldName)

                  const shown =
                    field.logicalType === 'date'
                      ? formatDate(
                          raw == null ? null : modelFieldValueText(raw),
                        )
                      : displayModelFieldValue(field, raw)

                  const result = resultByField.get(field.fieldName)
                  const limits = limitsByField.get(field.fieldName)

                  return [
                    field.label,
                    result ? (
                      <span
                        key={field.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1"
                      >
                        <span>{shown}</span>
                        <SpecVerdictBadge
                          verdict={result.verdict}
                          title={
                            limits
                              ? t('quality.limits.limitsTip', {
                                  range: describeLimits(limits),
                                })
                              : undefined
                          }
                        />
                      </span>
                    ) : (
                      shown
                    ),
                  ]
                },
              )}
            />
          </div>
        ),
      )}
    </div>
  )
}

function RecordPanels({ page }: { page: RecordPage }) {
  const { record, pluginPoints, modelKey, isRegistry, canWrite } = page

  return (
    <>
      {record
        ? pluginPoints.panels
            .filter(
              (panel) =>
                !panel.declaration.models ||
                panel.declaration.models.includes(modelKey),
            )
            .map((panel) => (
              <PluginScreen
                key={`${panel.extensionKey}-${panel.id}`}
                extensionKey={panel.extensionKey}
                pluginName={panel.extensionName}
                point="panels"
                itemId={panel.id}
                title={panel.declaration.title}
                source={panel.declaration.ui ? 'ui' : 'screen'}
                context={{ recordId: record.id, kind: modelKey }}
                operations={operationAccess(pluginPoints, panel.extensionKey)}
                scopes={pluginPoints.installed.get(panel.extensionKey)?.scopes}
              />
            ))
        : null}

      {isRegistry && record ? (
        <RegistryLineage
          entryId={record.id}
          identifier={record.identifier}
          canWrite={canWrite && !record.archived_at}
        />
      ) : null}
    </>
  )
}

function RecordRelated({ page }: { page: RecordPage }) {
  const { usedBy, timeline, timelineQuery, modelKey, model } = page

  return (
    <>
      <Section
        title={t('library.models.recordModelRecord.usedBy')}
        count={usedBy.length}
      >
        {usedBy.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-label">
            {usedBy.map((link) => (
              <li key={`${link.source?.id ?? 'unknown'}-${link.createdAt}`}>
                {link.source ? (
                  <Link
                    to="/records/$recordId"
                    params={{ recordId: link.source.id }}
                    className="text-link"
                  >
                    {link.source.identifier} · {link.source.title}
                  </Link>
                ) : (
                  <span className="text-fg-muted">
                    {t('library.models.recordModelRecord.aRecordNotVisibleIn')}
                  </span>
                )}
                <span className="text-fg-muted">
                  {' '}
                  · {link.linkType} · {formatDate(link.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-label text-fg-muted">
            {t('library.models.recordModelRecord.noRecordsLinkToThis')}
          </p>
        )}
      </Section>

      <Section title={t('library.models.recordModelRecord.history')}>
        <RecordHistoryTimeline
          events={timeline}
          loading={timelineQuery.isLoading}
          error={timelineQuery.error}
        />
      </Section>

      <Section title={t('library.models.recordModelRecord.integrations')}>
        <p className="m-0 text-label text-fg-muted">
          {timeline.length
            ? t('library.models.recordModelRecord.resultsFromQcLimsAnd')
            : t('library.models.recordModelRecord.resultsFromQcLimsAnd2')}
        </p>
      </Section>

      {/* MOB-02.4: RecordPhone draws the record's actions at the end of the
          column as full-width 44px targets, under the fields they act on. The
          desktop header keeps them. */}
      <div className="flex flex-col gap-2 md:hidden">
        <Button
          variant="primary"
          size="lg"
          nativeButton={false}
          render={
            <Link
              to="/models/$modelId/records/new"
              params={{ modelId: modelKey }}
            />
          }
        >
          {t('common.actions.new')} {model.data?.name ?? 'record'}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          nativeButton={false}
          render={
            <Link
              to="/models/$modelId/records"
              params={{ modelId: modelKey }}
            />
          }
        >
          {t('library.models.recordModelRecord.allRecords')}
        </Button>
      </div>
    </>
  )
}
