import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, PageHeader, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { RecordHistoryTimeline } from '#/components/audit/record-history-timeline'
import { pickerStatus } from '#/components/v3/record-picker/record-picker-data'
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
}: {
  modelKey: string
  recordId: string
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
          title="Record not found"
          description="This record is not visible in this workspace, or it has been removed."
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
              Back to records
            </Button>
          }
        />
      </div>
    )
  }

  const laterFields = record ? laterAddedModelFields(fields, record) : []
  const status = record ? pickerStatus(record.status) : null

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <PageHeader
        trail={[
          { label: 'Models', link: { to: '/models' } },
          {
            label: model.data?.name ?? modelKey,
            link: { to: '/models/$modelId', params: { modelId: modelKey } },
          },
          { label: record?.identifier ?? '…', mono: true },
        ]}
        title={record?.title ?? 'Record'}
        meta={
          record ? (
            <>
              {status ? (
                <span className="text-fg">
                  <Status tone={status.tone}>{status.label}</Status>
                </span>
              ) : null}
              <span>
                {model.data?.name ?? modelKey}
                {record.model_version
                  ? ` · model v${record.model_version.version}`
                  : ' · version not recorded'}
              </span>
            </>
          ) : (
            <span>Loading record…</span>
          )
        }
        actions={
          <div className="flex gap-2 max-md:hidden">
            {record?.model_version_id &&
            !fieldsQuery.isError &&
            !fieldsQuery.isLoading ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit details
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
              All records
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
              New {model.data?.name ?? 'record'}
            </Button>
          </div>
        }
      />
      <div className="flex min-w-0 flex-col gap-5 px-4 py-4 md:px-6">
        {laterFields.length ? (
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-label">
            <span className="font-medium">
              {laterFields.map((field) => field.label).join(', ')}
            </span>{' '}
            {laterFields.length === 1 ? 'was' : 'were'} added to this model
            after this record was created. The record still stands; add the
            value when you have it.
          </div>
        ) : null}

        <Section title="Details">
          {record && !record.model_version_id ? (
            <p role="status" className="text-label text-fg-muted">
              This legacy record has no saved Model version. Values are shown
              without applying current field labels or units.
            </p>
          ) : null}
          {fieldsQuery.isError ? (
            <p role="alert">
              The record’s Model version is unavailable. Current definitions
              have not been substituted.
            </p>
          ) : record && !fieldsQuery.isLoading ? (
            <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
              <DescriptionList
                items={[
                  ['ID', <span className="mono">{record.identifier}</span>],
                  ['Name', record.title],
                  ...(subtype
                    ? [
                        ['Type', subtype.name] as [
                          React.ReactNode,
                          React.ReactNode,
                        ],
                      ]
                    : []),
                  ['Status', status ? status.label : record.status],
                  ['Created', formatDate(record.created_at)],
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
              {fieldSections(fields).map((group) => (
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
                        return [
                          field.label,
                          field.logicalType === 'date'
                            ? formatDate(raw == null ? null : String(raw))
                            : displayModelFieldValue(field, raw),
                        ]
                      },
                    )}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-label text-fg-muted">Loading fields…</p>
          )}
        </Section>

        {record && editing ? (
          <RecordModelEditDialog
            open
            onOpenChange={setEditing}
            recordId={record.id}
            fields={fields.filter((field) => field.lifecycle === 'active')}
            stored={record.custom_fields}
          />
        ) : null}

        <Section title="Used by" count={usedBy.length}>
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
                      A record not visible in this workspace
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
              No records link to this one yet.
            </p>
          )}
        </Section>

        <Section title="History">
          <RecordHistoryTimeline
            events={timeline}
            loading={timelineQuery.isLoading}
            error={timelineQuery.error}
          />
        </Section>

        <Section title="Integrations">
          <p className="m-0 text-label text-fg-muted">
            {timeline.length
              ? 'Results from QC LIMS and other integrations arrive as history entries above. This record has history, so an integration write is one of those entries.'
              : 'Results from QC LIMS and other integrations arrive as history entries above. This record has no history yet, so no person, integration or API client has written to it.'}
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
            New {model.data?.name ?? 'record'}
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
            All records
          </Button>
        </div>
      </div>
    </div>
  )
}
