import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { EmptyState } from '#/components/v3/ui/empty-state'
import { FileDrop } from '#/components/v3/ui/file-drop'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Section,
} from '#/components/v3/ui/layout'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { Select } from '#/components/v3/ui/select'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { buttonVariants } from '#/components/v3/ui/button'
import {
  previewLines,
  uploadFileToExperiment,
  uploadFileVersion,
} from '#/lib/experiment-files'
import { formatDate, notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import {
  experimentQueryKeys,
  useExperimentLinks,
  useExperimentRecord,
} from '../$expId'
import { t } from '#/copy'

interface FileRecordWire {
  id: string
  identifier: string
  title: string
  created_by_user_id: string | null
  created_at: string
}

interface FileObjectWire {
  record_id: string
  version: number
  created_at: string
  display_name: string
  media_type: string
  byte_size: number | string
  checksum: string | null
  retention_until: string | null
  extracted_text: string | null
}

/** What a file went on to feed, as its link records it. */
interface FeedWire {
  source_record_id: string
  target_kind: string
  target_identifier: string
  link_metadata: {
    kind?: string
    instrument?: string
    parser?: string
    rows?: number
    version?: number
  } | null
}

export interface FileFeed {
  kind: string
  identifier: string
  receipt: NonNullable<FeedWire['link_metadata']>
}

/** One stored version of a file; the server's number is a concurrency
 * counter, so people see a version's position in the list instead. */
export interface FileVersion {
  version: number
  name: string
  byteSize: number
  checksum: string | null
  at: string
}

export interface ExperimentFile {
  id: string
  identifier: string
  name: string
  mediaType: string
  byteSize: number
  checksum: string | null
  retentionUntil: string | null
  text: string | null
  versions: FileVersion[]
  feeds: FileFeed[]
  uploadedBy: string | null
  uploadedAt: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return t('projects.expFiles.bytes', { value: bytes })
  if (bytes < 1024 * 1024)
    return t('projects.expFiles.kilobytes', { value: Math.round(bytes / 1024) })
  return t('projects.expFiles.megabytes', {
    value: (bytes / (1024 * 1024)).toFixed(1),
  })
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toUpperCase()
}

/** "Instrument export", "Protocol, controlled copy": what the file is for,
 * as its first link records it, else its file type. */
function kindOf(file: ExperimentFile): string {
  return (
    file.feeds.find((f) => f.receipt.kind)?.receipt.kind ?? extension(file.name)
  )
}

export function useExperimentFiles(expId: string) {
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
      const [records, objects, feedRows] = await Promise.all([
        notebookDataClient.list<FileRecordWire>(
          'records',
          `?id=in.(${list})&deleted_at=is.null&order=created_at.desc&select=id,identifier,title,created_by_user_id,created_at`,
        ),
        notebookDataClient.list<FileObjectWire>(
          'file_objects',
          `?record_id=in.(${list})&select=record_id,version,created_at,display_name,media_type,byte_size,checksum,retention_until,extracted_text&order=version.asc`,
        ),
        notebookDataClient.list<FeedWire>(
          'record_links',
          `?source_record_id=in.(${list})&link_type=in.(dataset,protocol)&select=source_record_id,target_kind,target_identifier,link_metadata`,
        ),
      ])
      // Oldest first, so the newest version is the one a record resolves to.
      const byRecord = new Map(objects.map((o) => [o.record_id, o]))
      const versionsOf = (id: string): FileVersion[] =>
        objects
          .filter((o) => o.record_id === id)
          .map((o) => ({
            version: o.version,
            name: o.display_name,
            byteSize: Number(o.byte_size),
            checksum: o.checksum,
            at: o.created_at,
          }))
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
          text: object?.extracted_text ?? null,
          feeds: feedRows
            .filter((f) => f.source_record_id === record.id)
            .map((f) => ({
              kind: f.target_kind,
              identifier: f.target_identifier,
              receipt: f.link_metadata ?? {},
            })),
          versions: versionsOf(record.id),
          uploadedBy: record.created_by_user_id,
          uploadedAt: record.created_at,
        }
      })
    },
  })
}

function FeedLinks({ feeds }: { feeds: FileFeed[] }) {
  if (feeds.length === 0) return <span className="text-fg-muted">—</span>
  return (
    <span className="flex flex-wrap gap-x-2">
      {feeds.map((feed) => (
        <ObjectLink
          key={`${feed.kind}:${feed.identifier}`}
          kind={feed.kind === 'dataset' ? 'dataset' : 'protocol'}
          identifier={feed.identifier}
        >
          {feed.receipt.version
            ? `${feed.identifier} v${feed.receipt.version}`
            : feed.identifier}
        </ObjectLink>
      ))}
    </span>
  )
}

/** Retention as the board says it: the year it runs to and how long that is. */
function retentionText(until: string | null, from: string): string {
  if (!until) return '—'
  const years = Math.round(
    (new Date(until).getTime() - new Date(from).getTime()) /
      (365.25 * 24 * 3600 * 1000),
  )
  return t('projects.expFiles.retention', {
    year: new Date(until).getUTCFullYear(),
    years,
  })
}

function FileInspector({
  file,
  onNewVersion,
  uploading,
}: {
  file: ExperimentFile
  onNewVersion: (file: File) => void
  uploading: boolean
}) {
  const lines = previewLines(file.text)
  const dataset = file.feeds.find((f) => f.kind === 'dataset')
  return (
    <Inspector aria-label={t('projects.expFiles.file')} className="w-[300px]">
      <div className="flex flex-col gap-1">
        <div className="font-heading text-doc font-semibold">{file.name}</div>
        <span className="text-label text-fg-muted">
          {kindOf(file)} · {formatSize(file.byteSize)} · {file.identifier}
        </span>
      </div>
      <div className="flex gap-2">
        <a
          href={`/api/files/${file.id}/download`}
          className={buttonVariants({ size: 'sm' })}
        >
          {t('projects.expFiles.download')}
        </a>
        <label
          className={buttonVariants({ size: 'sm' })}
          aria-disabled={uploading}
        >
          {uploading
            ? t('projects.expFiles.uploading')
            : t('projects.expFiles.newVersion')}
          <input
            type="file"
            className="sr-only"
            disabled={uploading}
            aria-label={t('projects.expFiles.newVersion')}
            onChange={(event) => {
              const next = event.target.files?.[0]
              event.target.value = ''
              if (next) onNewVersion(next)
            }}
          />
        </label>
      </div>
      {lines.length ? (
        <InspectorSection
          title={t('projects.expFiles.preview', { count: lines.length })}
        >
          <pre className="m-0 overflow-x-auto rounded-md bg-surface-muted p-2 font-mono text-label">
            {lines.join('\n')}
          </pre>
        </InspectorSection>
      ) : null}
      <InspectorSection title={t('projects.expFiles.record')}>
        <DescriptionList
          labelWidth={90}
          items={[
            ...(dataset?.receipt.instrument
              ? ([
                  [
                    t('projects.expFiles.instrument'),
                    dataset.receipt.instrument,
                  ],
                ] as Array<[string, React.ReactNode]>)
              : []),
            ...(dataset
              ? ([
                  [
                    t('projects.expFiles.parsedInto'),
                    <span key="into">
                      <ObjectLink
                        kind="dataset"
                        identifier={dataset.identifier}
                      />
                      {dataset.receipt.rows
                        ? t('projects.expFiles.rows', {
                            count: dataset.receipt.rows,
                          })
                        : ''}
                    </span>,
                  ],
                ] as Array<[string, React.ReactNode]>)
              : []),
            ...(dataset?.receipt.parser
              ? ([
                  [t('projects.expFiles.parser'), dataset.receipt.parser],
                ] as Array<[string, React.ReactNode]>)
              : []),
            [
              t('projects.expFiles.sha'),
              file.checksum ? (
                <span key="sha" className="mono">
                  {file.checksum.slice(0, 7)}…{file.checksum.slice(-6)}
                </span>
              ) : (
                '—'
              ),
            ],
            [
              t('projects.expFiles.retentionLabel'),
              retentionText(file.retentionUntil, file.uploadedAt),
            ],
          ]}
        />
      </InspectorSection>
      {file.versions.length > 1 ? (
        <InspectorSection
          title={t('projects.expFiles.versions', {
            count: file.versions.length,
          })}
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
            {file.versions
              .map((v, index) => ({ ...v, number: index + 1 }))
              .reverse()
              .map((v) => (
                <li key={v.version} className="flex items-baseline gap-2">
                  <span className="font-medium text-fg">
                    {t('projects.expFiles.versionNumber', { number: v.number })}
                  </span>
                  <span className="text-fg-muted">
                    {formatSize(v.byteSize)} · {formatDate(v.at)}
                    {v.checksum
                      ? t('projects.expFiles.checksumShort', {
                          checksum: v.checksum.slice(0, 7),
                        })
                      : ''}
                  </span>
                  <span className="flex-1" />
                  <a
                    className="text-link underline"
                    href={`/api/files/${file.id}/download?version=${v.version}`}
                  >
                    {t('projects.expFiles.download')}
                  </a>
                </li>
              ))}
          </ul>
        </InspectorSection>
      ) : null}
      <p className="m-0 text-label text-fg-muted">
        {t('projects.expFiles.immutable', {
          next: file.versions.length + 1,
          current: file.versions.length,
        })}
      </p>
    </Inspector>
  )
}

type SortKey = 'uploaded' | 'name'

/** The files attached to this experiment: instrument exports and documents,
 * what each fed, and the selected file's preview, record and retention. */
export function ExperimentFiles({ expId }: { expId: string }) {
  const files = useExperimentFiles(expId)
  const record = useExperimentRecord(expId)
  const queryClient = useQueryClient()
  const all = files.data ?? []
  const { userLabel } = useUserNames(
    all.flatMap((f) => (f.uploadedBy ? [f.uploadedBy] : [])),
  )
  const [kind, setKind] = useState('all')
  const [sort, setSort] = useState<SortKey>('uploaded')
  const [picked, setPicked] = useState<string | null>(null)
  const kinds = [...new Set(all.map(kindOf))]
  const rows = useMemo(
    () =>
      all
        .filter((f) => kind === 'all' || kindOf(f) === kind)
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : b.uploadedAt.localeCompare(a.uploadedAt),
        ),
    [all, kind, sort],
  )
  const selectedId = picked ?? rows.at(0)?.id ?? null
  const selected = rows.find((f) => f.id === selectedId)
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setPicked,
  )
  const projectId = record.data?.project_id ?? null
  const upload = useMutation({
    mutationFn: async (file: File | null) => {
      if (!file || !projectId) return
      await uploadFileToExperiment(notebookDataClient, {
        projectId,
        experimentId: expId,
        file,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: experimentQueryKeys.links(expId),
      })
      toast(t('projects.expFiles.fileUploaded'))
    },
  })
  const newVersion = useMutation({
    mutationFn: (next: File) =>
      uploadFileVersion({ fileId: selectedId!, file: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'experiment-files', expId],
      })
      toast(t('projects.expFiles.versionSaved'))
    },
    onError: (error: unknown) =>
      toast(t('projects.expFiles.versionFailed'), {
        description:
          error instanceof Error
            ? error.message
            : t('projects.expFiles.uploadFailed'),
      }),
  })
  const columns: RegistryColumn<ExperimentFile>[] = [
    {
      id: 'name',
      header: t('projects.expFiles.name'),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <span className="mono rounded-sm bg-surface-muted px-1 text-label text-fg-muted">
            {extension(row.original.name)}
          </span>
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'kind',
      header: t('projects.expFiles.kind'),
      cell: ({ row }) => kindOf(row.original),
    },
    {
      id: 'feeds',
      header: t('projects.expFiles.feeds'),
      cell: ({ row }) => <FeedLinks feeds={row.original.feeds} />,
    },
    {
      id: 'size',
      header: t('projects.expFiles.size'),
      meta: { cellClassName: 'num' },
      cell: ({ row }) => formatSize(row.original.byteSize),
    },
    {
      id: 'by',
      header: t('projects.expFiles.uploadedBy'),
      cell: ({ row }) =>
        row.original.uploadedBy ? userLabel(row.original.uploadedBy) : '—',
    },
    {
      id: 'uploaded',
      header: t('projects.expFiles.uploaded'),
      meta: { cellClassName: 'num text-fg-muted' },
      cell: ({ row }) => formatDate(row.original.uploadedAt),
    },
  ]
  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[14px] overflow-auto px-4 py-[22px] md:px-8">
        <Section
          title={t('projects.expFiles.files')}
          count={all.length}
          action={
            <Link
              to="/import"
              search={{ experiment: expId }}
              className={buttonVariants({ size: 'sm', variant: 'primary' })}
            >
              {t('projects.expFiles.upload')}
            </Link>
          }
        >
          <div className="mb-2 flex items-center gap-3 text-label text-fg-muted">
            <label className="flex items-center gap-1.5">
              {t('projects.expFiles.kind')}
              <Select
                size="sm"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="all">{t('projects.expFiles.allKinds')}</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-1.5">
              {t('projects.expSamples.sort')}
              <Select
                size="sm"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="uploaded">
                  {t('projects.expFiles.uploaded')}
                </option>
                <option value="name">{t('projects.expFiles.name')}</option>
              </Select>
            </label>
          </div>
          {all.length ? (
            <TableBox>
              <RegistryGrid
                label={t('projects.expFiles.files')}
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
              title={t('projects.expLinks.none.file.title')}
              description={t('projects.expLinks.none.file.body')}
            />
          )}
          <div className="mt-3">
            <FileDrop
              label={t('projects.expFiles.drop')}
              hint={t('projects.expFiles.dropHint')}
              disabled={!projectId}
              disabledReason={t('projects.expFiles.noProject')}
              onFile={(file) => upload.mutateAsync(file)}
            />
          </div>
        </Section>
      </div>
      {selected ? (
        <FileInspector
          file={selected}
          onNewVersion={(next) => newVersion.mutate(next)}
          uploading={newVersion.isPending}
        />
      ) : null}
    </>
  )
}
