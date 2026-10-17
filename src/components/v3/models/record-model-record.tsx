import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { RecordHistoryTimeline } from '#/components/audit/record-history-timeline'
import { pickerStatus } from '#/components/v3/record-picker/record-picker-data'
import { formatDate } from '#/lib/notebook-data'
import { displayModelFieldValue } from '#/lib/model-fields'
import {
  laterAddedModelFields,
  recordFieldValue,
  useRecordModelFields,
  useRecordModelRecord,
  useRecordModelTimeline,
  useRecordModelUsedBy,
  useWorkspaceRecordModel,
} from './models-data'

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
  const fieldsQuery = useRecordModelFields(modelKey)
  const recordQuery = useRecordModelRecord(recordId)
  const usedByQuery = useRecordModelUsedBy(recordId)
  const timelineQuery = useRecordModelTimeline(recordId)

  const fields = fieldsQuery.data ?? []
  const record = recordQuery.data
  const usedBy = usedByQuery.data ?? []
  const timeline = timelineQuery.data ?? []

  if (!recordQuery.isLoading && !record) {
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
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-label text-fg-muted">
            {record ? (
              <>
                <span className="mono">{record.identifier}</span>
                {status ? (
                  <Status tone={status.tone}>{status.label}</Status>
                ) : null}
                <span>
                  {model.data?.name ?? modelKey}
                  {model.data ? ` · model v${model.data.current_version}` : ''}
                </span>
              </>
            ) : (
              'Loading record…'
            )}
          </p>
          <h2 className="mt-1 mb-0 text-title">{record?.title ?? 'Record'}</h2>
        </div>
        <div className="flex gap-2 max-md:hidden">
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
      </div>

      {laterFields.length ? (
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-label">
          <span className="font-medium">
            {laterFields.map((field) => field.label).join(', ')}
          </span>{' '}
          {laterFields.length === 1 ? 'was' : 'were'} added to this model after
          this record was created. The record still stands; add the value when
          you have it.
        </div>
      ) : null}

      <Section title="Details">
        {record ? (
          <DescriptionList
            items={[
              ['ID', <span className="mono">{record.identifier}</span>],
              ['Name', record.title],
              ['Status', status ? status.label : record.status],
              ['Created', formatDate(record.created_at)],
              ...fields.map<[React.ReactNode, React.ReactNode]>((field) => {
                // A date-typed field stores an ISO date; show it in the same
                // short form as the record's own metadata, not the raw string.
                const raw = recordFieldValue(record, field.fieldName)
                return [
                  field.label,
                  field.logicalType === 'date'
                    ? formatDate(raw == null ? null : String(raw))
                    : displayModelFieldValue(field, raw),
                ]
              }),
            ]}
          />
        ) : (
          <p className="text-label text-fg-muted">Loading fields…</p>
        )}
      </Section>

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
  )
}
