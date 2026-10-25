import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Inspector, Section } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Link } from '@tanstack/react-router'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import { useExperimentLinks } from '../$expId'

interface FileRecordWire {
  id: string
  identifier: string
  title: string
  created_by_user_id: string | null
  created_at: string
}

interface FileObjectWire {
  record_id: string
  display_name: string
  media_type: string
  byte_size: number | string
  checksum: string | null
  retention_until: string | null
}

interface ExperimentFile {
  id: string
  identifier: string
  name: string
  mediaType: string
  byteSize: number
  checksum: string | null
  retentionUntil: string | null
  uploadedBy: string | null
  uploadedAt: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatKind(mediaType: string): string {
  const subtype = mediaType.split('/')[1] ?? mediaType
  return subtype
    .replace(/^vnd\./, '')
    .replace(/\+.*$/, '')
    .toUpperCase()
}

function useExperimentFiles(expId: string) {
  const links = useExperimentLinks(expId)
  const ids = [
    ...new Set(
      (links.data ?? [])
        .filter((link) => link.target_kind === 'file')
        .map((link) => link.target_record_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  return useQuery({
    queryKey: ['ui-port', 'experiment-files', expId, ids],
    enabled: links.isSuccess,
    queryFn: async (): Promise<ExperimentFile[]> => {
      if (ids.length === 0) return []
      const list = ids.map(encodeURIComponent).join(',')
      const [records, objects] = await Promise.all([
        notebookDataClient.list<FileRecordWire>(
          'records',
          `?id=in.(${list})&deleted_at=is.null&order=created_at.desc&select=id,identifier,title,created_by_user_id,created_at`,
        ),
        notebookDataClient.list<FileObjectWire>(
          'file_objects',
          `?record_id=in.(${list})&select=record_id,display_name,media_type,byte_size,checksum,retention_until`,
        ),
      ])
      const byRecord = new Map(objects.map((o) => [o.record_id, o]))
      return records.map((record) => {
        const object = byRecord.get(record.id)
        return {
          id: record.id,
          identifier: record.identifier,
          name: object?.display_name ?? record.title,
          mediaType: object?.media_type ?? '',
          byteSize: Number(object?.byte_size ?? 0),
          checksum: object?.checksum ?? null,
          retentionUntil: object?.retention_until ?? null,
          uploadedBy: record.created_by_user_id,
          uploadedAt: record.created_at,
        }
      })
    },
  })
}

/** The files attached to this experiment: instrument exports and documents,
 * with the selected file's identity and retention beside the list. */
export function ExperimentFiles({ expId }: { expId: string }) {
  const files = useExperimentFiles(expId)
  const rows = files.data ?? []
  const { userLabel } = useUserNames(
    rows.flatMap((f) => (f.uploadedBy ? [f.uploadedBy] : [])),
  )
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId = picked ?? rows.at(0)?.id ?? null
  const selected = rows.find((f) => f.id === selectedId)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setPicked,
  )
  const columns: RegistryColumn<ExperimentFile>[] = [
    { id: 'name', header: 'Name', accessorFn: (f) => f.name },
    {
      id: 'kind',
      header: 'Kind',
      cell: ({ row }) => formatKind(row.original.mediaType),
    },
    {
      id: 'size',
      header: 'Size',
      meta: { cellClassName: 'num' },
      cell: ({ row }) => formatSize(row.original.byteSize),
    },
    {
      id: 'by',
      header: 'Uploaded by',
      cell: ({ row }) =>
        row.original.uploadedBy ? userLabel(row.original.uploadedBy) : '—',
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      meta: { cellClassName: 'num text-fg-muted' },
      cell: ({ row }) => formatDate(row.original.uploadedAt),
    },
  ]
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        <Section
          title="Files"
          count={rows.length}
          action={
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/import" search={{ experiment: expId }} />}
            >
              Upload
            </Button>
          }
        >
          {rows.length ? (
            <TableBox>
              <RegistryGrid
                label="Files"
                rows={rows}
                columns={columns}
                getRowId={(f) => f.id}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                isLoading={files.isLoading}
              />
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              title="No files linked"
              description="Files attached to this experiment appear here."
            />
          )}
        </Section>
      </div>
      {selected ? (
        <Inspector aria-label="File" className="w-[300px]">
          <div className="flex flex-col gap-1">
            <span className="mono text-fg-muted">{selected.identifier}</span>
            <div className="font-heading text-doc font-semibold">
              {selected.name}
            </div>
          </div>
          <DescriptionList
            labelWidth={90}
            items={[
              ['Kind', formatKind(selected.mediaType)],
              ['Size', formatSize(selected.byteSize)],
              [
                'SHA-256',
                selected.checksum ? (
                  <span key="sha" className="mono">
                    {selected.checksum.slice(0, 12)}…
                  </span>
                ) : (
                  '—'
                ),
              ],
              [
                'Retention',
                selected.retentionUntil
                  ? `Until ${formatDate(selected.retentionUntil)}`
                  : '—',
              ],
            ]}
          />
          <p className="m-0 text-label text-fg-muted">
            Raw files can't be edited or deleted. A new upload becomes version
            2; version 1 and its hash stay in History.
          </p>
        </Inspector>
      ) : null}
    </>
  )
}
