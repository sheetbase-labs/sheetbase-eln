import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Section,
} from '#/components/v3/ui/layout'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Select } from '#/components/v3/ui/select'
import { Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { PrintLabelsDialog } from '#/components/v3/samples/sample-label-sheet'
import { sampleStatus } from '#/components/v3/samples/samples-data'
import { LinkSamplesAction } from './-links-tab'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { useExperimentLinks } from '../$expId'

interface SampleWire {
  id: string
  identifier: string
  title: string
  status: string
  metadata_version: number
  created_at: string
  created_by_user_id: string | null
  properties: Record<string, unknown> | null
  custom_fields: Record<string, unknown> | null
}

interface SampleLinkWire {
  source_record_id: string
  target_record_id: string | null
  link_metadata: { relation?: string } | null
}

interface SampleRow extends SampleWire {
  parentId: string | null
  /** The parent's identifier, resolved here so a cell never reads outside its row. */
  parentIdentifier: string | null
  relation: string | null
}

function text(row: SampleWire, key: string): string | null {
  const value = row.properties?.[key]
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null
}

/** 4,600 and 15.0: whole numbers from a hundred up, one decimal below. */
function volume(row: SampleWire): string {
  const quantity = Number(text(row, 'quantity'))
  if (!Number.isFinite(quantity) || text(row, 'quantity') === null) return '—'
  return quantity >= 100
    ? quantity.toLocaleString('en-GB')
    : quantity.toFixed(1)
}

function statusOf(row: SampleWire) {
  return sampleStatus(row.status, text(row, 'releasedAt'))
}

/** The experiment's samples, each with the sample it was made from, read from
 * the links between the samples themselves. */
function useExperimentSamples(expId: string) {
  const links = useExperimentLinks(expId)
  const ids = [
    ...new Set(
      (links.data ?? [])
        .filter((l) => l.target_kind === 'sample')
        .map((l) => l.target_record_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  return useQuery({
    queryKey: ['ui-port', 'experiment-samples-table', expId, ids],
    enabled: links.isSuccess,
    queryFn: async (): Promise<SampleRow[]> => {
      if (ids.length === 0) return []
      const list = ids.join(',')
      const [samples, parents] = await Promise.all([
        notebookDataClient.list<SampleWire>(
          'records',
          `?id=in.(${list})&deleted_at=is.null&order=identifier.asc&select=id,identifier,title,status,metadata_version,created_at,created_by_user_id,properties,custom_fields`,
        ),
        notebookDataClient.list<SampleLinkWire>(
          'record_links',
          `?target_record_id=in.(${list})&link_type=eq.sample&target_kind=eq.sample&select=source_record_id,target_record_id,link_metadata`,
        ),
      ])
      const parentOf = new Map(
        // The experiment links its samples the same way, so a parent is a link
        // whose source is itself one of these samples.
        parents.flatMap((p) =>
          p.target_record_id && ids.includes(p.source_record_id)
            ? [
                [
                  p.target_record_id,
                  {
                    id: p.source_record_id,
                    relation: p.link_metadata?.relation,
                  },
                ] as const,
              ]
            : [],
        ),
      )
      const identifierOf = new Map(samples.map((s) => [s.id, s.identifier]))
      return samples.map((s) => {
        const parent = parentOf.get(s.id)
        return {
          ...s,
          parentId: parent?.id ?? null,
          parentIdentifier: parent
            ? (identifierOf.get(parent.id) ?? null)
            : null,
          relation: parent?.relation ?? null,
        }
      })
    },
  })
}

/** Where a sample came from, oldest first, ending at the sample itself. */
function chain(rows: readonly SampleRow[], id: string): SampleRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: SampleRow[] = []
  let at = byId.get(id)
  while (at && out.length < 6) {
    out.unshift(at)
    at = at.parentId ? byId.get(at.parentId) : undefined
  }
  return out
}

function usedInQuery(sampleId: string) {
  return {
    queryKey: ['ui-port', 'sample-used-in', sampleId],
    queryFn: () =>
      notebookDataClient.list<{
        source_record_id: string
        source: { identifier: string; kind: string } | null
      }>(
        'record_links',
        `?target_record_id=eq.${sampleId}&link_type=eq.sample&select=source_record_id`,
      ),
  }
}

function SampleInspector({
  row,
  rows,
}: {
  row: SampleRow
  rows: readonly SampleRow[]
}) {
  const status = statusOf(row)
  const ancestors = chain(rows, row.id)
  const usedIn = useQuery(usedInQuery(row.id))
  const { userLabel } = useUserNames(
    row.created_by_user_id ? [row.created_by_user_id] : [],
  )
  const type = text(row, 'sampleType')
  return (
    <Inspector aria-label="Sample" className="w-[300px]">
      <div className="flex flex-col gap-1">
        <span className="mono text-fg-muted">{row.identifier}</span>
        <div className="font-heading text-doc font-semibold">{row.title}</div>
        <Status tone={status.tone}>{status.label}</Status>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link to="/samples/$sampleId" params={{ sampleId: row.id }} />
          }
        >
          Open sample
        </Button>
        <Button
          size="sm"
          nativeButton={false}
          render={
            <Link
              to="/samples/$sampleId/lineage"
              params={{ sampleId: row.id }}
            />
          }
        >
          Full lineage
        </Button>
      </div>
      <InspectorSection title="Lineage">
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {ancestors.map((a, i) => (
            <li key={a.id} className="flex flex-col gap-0.5">
              {i > 0 ? (
                <span className="pl-2 text-label text-fg-muted">
                  ↓ {ancestors[i].relation ?? 'derived'}
                </span>
              ) : null}
              <span
                className={
                  a.id === row.id
                    ? 'rounded-md border border-accent px-2 py-1 text-body'
                    : 'rounded-md border border-border px-2 py-1 text-body'
                }
              >
                <span className="mono">{a.identifier}</span>{' '}
                {a.id === row.id ? 'This sample' : a.title}
              </span>
            </li>
          ))}
        </ol>
      </InspectorSection>
      <InspectorSection title="Properties">
        <DescriptionList
          labelWidth={110}
          items={[
            ...(type ? ([['Type', type]] as Array<[string, string]>) : []),
            ['Volume', `${volume(row)} ${text(row, 'quantityUnit') ?? ''}`],
            ['Location', text(row, 'storageLocation') ?? '—'],
            [
              'Created by',
              `${row.created_by_user_id ? userLabel(row.created_by_user_id) : '—'}, ${formatDate(row.created_at)}`,
            ],
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Used in">
        {usedIn.data?.length ? (
          <p className="m-0 text-label text-fg-muted">
            Linked from {usedIn.data.length}{' '}
            {usedIn.data.length === 1 ? 'record' : 'records'}.
          </p>
        ) : (
          <p className="m-0 text-label text-fg-muted">
            Not used in another record.
          </p>
        )}
      </InspectorSection>
    </Inspector>
  )
}

type SortKey = 'id' | 'created'

/** The experiment's samples as a table: what each one is, what it came from,
 * where it sits and what state it is in, with its lineage beside it. */
export function ExperimentSamples({ expId }: { expId: string }) {
  const samples = useExperimentSamples(expId)
  const all = samples.data ?? []
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<SortKey>('id')
  const [picked, setPicked] = useState<string | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const statuses = [...new Set(all.map((r) => statusOf(r).label))]
  const rows = useMemo(
    () =>
      all
        .filter((r) => status === 'all' || statusOf(r).label === status)
        .sort((a, b) =>
          sort === 'created'
            ? a.created_at.localeCompare(b.created_at)
            : a.identifier.localeCompare(b.identifier),
        ),
    [all, status, sort],
  )
  const selectedId = picked ?? rows.at(0)?.id ?? null
  const selected = rows.find((r) => r.id === selectedId)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setPicked,
  )
  const columns: RegistryColumn<SampleRow>[] = [
    {
      id: 'id',
      header: 'ID',
      cell: ({ row }) => (
        <ObjectLink
          kind="sample"
          id={row.original.id}
          identifier={row.original.identifier}
        />
      ),
    },
    { id: 'name', header: 'Name', accessorFn: (s) => s.title },
    {
      id: 'type',
      header: 'Type',
      accessorFn: (s) => text(s, 'sampleType') ?? '—',
    },
    {
      id: 'parent',
      header: 'Parent',
      cell: ({ row }) =>
        row.original.parentId && row.original.parentIdentifier ? (
          <ObjectLink
            kind="sample"
            id={row.original.parentId}
            identifier={row.original.parentIdentifier}
          />
        ) : (
          '—'
        ),
    },
    {
      id: 'volume',
      header: 'Volume (mL)',
      meta: { cellClassName: 'num' },
      accessorFn: (s) => volume(s),
    },
    {
      id: 'location',
      header: 'Location',
      accessorFn: (s) => text(s, 'storageLocation') ?? '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const s = statusOf(row.original)
        return <Status tone={s.tone}>{s.label}</Status>
      },
    },
    {
      id: 'created',
      header: 'Created',
      meta: { cellClassName: 'num text-fg-muted' },
      cell: ({ row }) => formatDate(row.original.created_at),
    },
  ]
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[14px] overflow-auto px-4 py-[22px] md:px-8">
        <Section
          title="Samples"
          count={all.length}
          action={
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={rows.length === 0}
                onClick={() => setPrintOpen(true)}
              >
                Print labels
              </Button>
              <Button
                size="sm"
                nativeButton={false}
                render={
                  <Link
                    to="/samples"
                    search={{
                      new: true,
                      experiment: expId,
                      returnTo: `/experiments/${expId}/samples`,
                    }}
                  />
                }
              >
                Register sample
              </Button>
              <LinkSamplesAction expId={expId} />
            </span>
          }
        >
          <div className="mb-2 flex items-center gap-3 text-label text-fg-muted">
            <label className="flex items-center gap-1.5">
              Status
              <Select
                size="sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1.5">
              Sort
              <Select
                size="sm"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="id">ID</option>
                <option value="created">Created</option>
              </Select>
            </label>
          </div>
          {all.length ? (
            <TableBox>
              <RegistryGrid
                label="Samples"
                rows={rows}
                columns={columns}
                getRowId={(s) => s.id}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                isLoading={samples.isLoading}
              />
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              title="No samples linked"
              description="Samples used in this experiment appear here when they are linked or withdrawn for it."
            />
          )}
          <p className="mb-0 mt-2 text-label text-fg-muted">
            {rows.length} {rows.length === 1 ? 'sample' : 'samples'}
            {' · '}Volumes are current, after withdrawals
          </p>
        </Section>
      </div>
      {selected ? <SampleInspector row={selected} rows={all} /> : null}
      <PrintLabelsDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        records={rows.map((r) => ({
          id: r.id,
          metadataVersion: r.metadata_version,
          identifier: r.identifier,
          title: r.title,
          sampleType: text(r, 'sampleType'),
          createdAt: r.created_at,
          properties: r.properties,
          customFields: r.custom_fields,
        }))}
        scope={`the ${rows.length} samples shown`}
      />
    </>
  )
}
