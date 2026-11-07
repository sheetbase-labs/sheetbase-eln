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
import { displayModelFieldValue } from '#/lib/model-fields'
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
import { useModelFeatures } from '#/lib/features/data'
import { CAMPAIGNS_FEATURE } from '#/lib/features/registry'
import {
  RegistryLineage,
  RegistryRetireButton,
} from '#/components/registry/registry-lineage'
import { CompoundPanel } from '#/components/registry/compound-panel'

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
export function RecordModelRecord({
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
  // A record given a subtype pins the subtype's version and carries every
  // field from this model down to it.
  const types = useModelTypes()
  const pinnedType = typeForVersion(
    types.data ?? [],
    recordQuery.data?.model_version_id,
  )
  const subtype = pinnedType && pinnedType.key !== modelKey ? pinnedType : null
  const ownFields = useRecordModelFields(
    recordQuery.data?.model_version_id && !subtype && !types.isLoading
      ? modelKey
      : '',
    notebookDataClient,
    recordQuery.data?.model_version_id ?? undefined,
  )
  const chainFields = useTypeFields(
    types.data,
    modelKey,
    subtype?.key ?? null,
    recordQuery.data?.model_version_id ?? null,
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
  const usedByQuery = useRecordModelUsedBy(recordId)
  const quality = useRecordQuality(model.data?.workspace_id, modelKey, recordId)
  const timelineQuery = useRecordModelTimeline(recordId)

  const [editing, setEditing] = useState(false)
  const fields = fieldsQuery.data ?? []
  const record = recordQuery.data
  const usedBy = usedByQuery.data ?? []
  const timeline = timelineQuery.data ?? []

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
  const structureField = isRegistry
    ? (model.data?.registry_structure_field ?? null)
    : null
  const modelFeatures = useModelFeatures()
  const isCampaign = Boolean(
    modelFeatures.data?.some(
      (f) => f.model_key === modelKey && f.capability === CAMPAIGNS_FEATURE,
    ),
  )
  const canWrite = hasCapability(role, 'record.create')

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
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
            {isCampaign && record ? (
              <Button
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/campaigns/$campaignId"
                    params={{ campaignId: record.id }}
                  />
                }
              >
                {t('planner.campaigns.openCampaign')}
              </Button>
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
            <div className="grid items-start gap-x-10 gap-y-5 md:grid-cols-2">
              <DescriptionList
                items={[
                  ['ID', <span className="mono">{record.identifier}</span>],
                  [t('library.models.recordModelRecord.name'), record.title],
                  ...(subtype
                    ? [
                        [
                          t('library.models.recordModelRecord.type'),
                          subtype.name,
                        ] as [React.ReactNode, React.ReactNode],
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
                        value == null
                          ? '—'
                          : typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value),
                      ])
                    : []),
                ]}
              />
              {fieldSections(
                structureField
                  ? fields.filter((f) => f.fieldName !== structureField)
                  : fields,
              ).map((group) => (
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
                            ? formatDate(raw == null ? null : String(raw))
                            : displayModelFieldValue(field, raw)
                        const result = resultByField.get(field.fieldName)
                        const limits = limitsByField.get(field.fieldName)
                        return [
                          field.label,
                          result ? (
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
              ))}
            </div>
          ) : (
            <p className="text-label text-fg-muted">
              {t('library.models.recordModelRecord.loadingFields')}
            </p>
          )}
        </Section>

        {record && editing ? (
          <RecordModelEditDialog
            open
            onOpenChange={setEditing}
            recordId={record.id}
            fields={fields.filter(
              (field) =>
                field.lifecycle === 'active' &&
                field.fieldName !== structureField,
            )}
            stored={record.custom_fields}
          />
        ) : null}

        {structureField && record ? (
          <CompoundPanel
            recordId={record.id}
            identifier={record.identifier}
            kind={modelKey}
            molfile={
              typeof record.custom_fields?.[structureField] === 'string'
                ? String(record.custom_fields[structureField])
                : ''
            }
            metadataVersion={record.metadata_version ?? 1}
            lotKind={model.data?.registry_lot_kind ?? null}
            canWrite={canWrite && !record.archived_at}
          />
        ) : null}

        {isRegistry && record ? (
          <RegistryLineage
            entryId={record.id}
            identifier={record.identifier}
            canWrite={canWrite && !record.archived_at}
          />
        ) : null}

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
                      {t(
                        'library.models.recordModelRecord.aRecordNotVisibleIn',
                      )}
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
      </div>
    </div>
  )
}
