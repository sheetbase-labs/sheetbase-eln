/**
 * PROJ-04.4 — the project's files tab.
 *
 * A file is a record of kind 'file' with a 1:1 api.file_objects row, so the tab lists
 * the project's file records and joins their object metadata. The columns are Name,
 * Kind, Size, Uploaded by and Uploaded; the reader is paged so a project with more
 * files than one page says so rather than dropping the rest.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import {
  ProjectList,
  ProjectListFailure,
  ProjectListOutOfRange,
} from '#/components/v3/projects/project-list'
import { Pager } from '#/components/v3/ui/pager'
import {
  PROJECT_LIST_PAGE_SIZE,
  parseProjectPage,
  projectPageOffset,
  projectPageSummary,
} from '#/components/v3/projects/project-lists'
import { useUserNames } from '#/lib/user-names'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'

export const Route = createFileRoute('/projects/$projectId/files')({
  validateSearch: (search: Record<string, unknown>): { page?: number } => {
    const page = parseProjectPage(search.page)
    return page > 1 ? { page } : {}
  },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) throw redirect({ to: '/sign-in' })
    return { context }
  },
  component: ProjectFilesTab,
})

interface FileRecordWire {
  id: string
  identifier: string
  title: string
  created_by_user_id: string | null
  created_at: string
}

interface FileObjectWire {
  record_id: string | null
  display_name: string
  media_type: string | null
  byte_size: number | null
}

interface ProjectFile {
  id: string
  identifier: string
  name: string
  mediaType: string | null
  byteSize: number | null
  uploadedBy: string | null
  uploadedAt: string
}

/** The row the tab renders; `uploadedBy` is the resolved name, never a raw id. */
export interface ProjectFileDisplayRow {
  key: string
  id: string
  name: string
  kind: string
  size: string
  uploadedBy: string
  uploaded: string
}

export function toFileDisplayRows(
  files: readonly ProjectFile[],
  userLabel: (userId: string) => string,
): ProjectFileDisplayRow[] {
  return files.map((file) => ({
    key: file.id,
    id: file.identifier,
    name: file.name,
    kind: formatKind(file.mediaType),
    size: formatSize(file.byteSize),
    uploadedBy: file.uploadedBy ? userLabel(file.uploadedBy) : '—',
    uploaded: day(file.uploadedAt),
  }))
}

export interface ProjectFilesPage {
  rows: ProjectFile[]
  total: number
  page: number
}

const FILE_FILTER = (projectId: string) =>
  `project_id=eq.${encodeURIComponent(projectId)}&kind=eq.file&deleted_at=is.null`

export async function fetchProjectFilesPage(
  client: DataClient,
  projectId: string,
  page: number,
): Promise<ProjectFilesPage> {
  const filter = FILE_FILTER(projectId)
  const offset = projectPageOffset(page)
  const [records, total] = await Promise.all([
    client.list<FileRecordWire>(
      'records',
      `?${filter}&order=created_at.desc,id.asc&limit=${PROJECT_LIST_PAGE_SIZE}&offset=${offset}` +
        `&select=id,identifier,title,created_by_user_id,created_at`,
    ),
    client.count('records', `?${filter}`),
  ])
  if (records.length === 0) return { rows: [], total, page }
  const ids = records.map((record) => record.id)
  const objects = await client.list<FileObjectWire>(
    'file_objects',
    `?record_id=in.(${ids.map(encodeURIComponent).join(',')})` +
      `&select=record_id,display_name,media_type,byte_size`,
  )
  const byRecord = new Map(objects.map((object) => [object.record_id, object]))
  const rows = records.map((record) => {
    const object = byRecord.get(record.id)
    return {
      id: record.id,
      identifier: record.identifier,
      name: object?.display_name ?? record.title,
      mediaType: object?.media_type ?? null,
      byteSize: object?.byte_size ?? null,
      uploadedBy: record.created_by_user_id,
      uploadedAt: record.created_at,
    }
  })
  return { rows, total, page }
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatKind(mediaType: string | null): string {
  if (!mediaType) return '—'
  const subtype = mediaType.split('/')[1] ?? mediaType
  return subtype
    .replace(/^vnd\./, '')
    .replace(/\+.*$/, '')
    .toUpperCase()
}

function day(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function ProjectFilesTab() {
  const { projectId } = Route.useParams()
  const { page: pageParam } = Route.useSearch()
  const page = pageParam ?? 1
  const query = useQuery({
    queryKey: ['ui-port', 'project-files', projectId, page],
    queryFn: () => fetchProjectFilesPage(notebookDataClient, projectId, page),
    enabled: projectId.length > 0,
    staleTime: 15_000,
  })
  const rows = query.data?.rows ?? []
  const total = query.data?.total ?? 0

  const { userLabel } = useUserNames(
    useMemo(
      () => rows.flatMap((file) => (file.uploadedBy ? [file.uploadedBy] : [])),
      [rows],
    ),
  )
  const display = useMemo(
    () => toFileDisplayRows(rows, userLabel),
    [rows, userLabel],
  )

  if (query.isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col overflow-auto px-4 py-[22px] md:px-8">
        <ProjectListFailure
          error={query.error}
          onRetry={() => void query.refetch()}
          what="this project's files"
        />
      </div>
    )
  }

  const { pageCount, start, end } = projectPageSummary(page, total)

  if (total > 0 && page > pageCount) {
    return (
      <ProjectListOutOfRange
        total={total}
        label="files"
        link={{
          to: '/projects/$projectId/files',
          params: { projectId },
          search: {},
        }}
      />
    )
  }

  return (
    <ProjectList
      title="Files"
      count={total}
      cols={[
        {
          key: 'name',
          label: 'Name',
          cell: (file) => (
            <Link
              to="/records/$recordId"
              params={{ recordId: file.key }}
              className="hover:underline"
            >
              {file.name}
            </Link>
          ),
        },
        { key: 'kind', label: 'Kind', cell: (file) => file.kind },
        {
          key: 'size',
          label: 'Size',
          align: 'right',
          cell: (file) => file.size,
        },
        {
          key: 'uploadedBy',
          label: 'Uploaded by',
          cell: (file) => file.uploadedBy,
        },
        {
          key: 'uploaded',
          label: 'Uploaded',
          align: 'right',
          className: 'text-fg-muted',
          cell: (file) => file.uploaded,
        },
      ]}
      rows={display}
      mobile={display.map((file) => ({
        key: file.key,
        title: file.name,
        meta: (
          <>
            <span className="mono">{file.id}</span> · {file.kind} · {file.size}{' '}
            · {file.uploaded}
          </>
        ),
        link: { to: '/records/$recordId', params: { recordId: file.key } },
      }))}
      empty={{
        icon: 'upload',
        title: 'No files yet',
        body: "Files uploaded to this project's records appear here.",
      }}
      footer={
        total > PROJECT_LIST_PAGE_SIZE ? (
          <Pager
            page={page}
            pageCount={pageCount}
            start={start}
            end={end}
            total={total}
            noun="files"
            linkFor={(next) => ({
              to: '/projects/$projectId/files',
              params: { projectId },
              search: { page: next },
            })}
          />
        ) : undefined
      }
    />
  )
}
