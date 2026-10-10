/**
 * PROJ-04.4 — the project's files tab.
 *
 * A file is a record of kind 'file' with a 1:1 api.file_objects row, so the tab lists
 * the project's file records and joins their object metadata. The design's columns are
 * Name, Kind, Linked to, Size, Uploaded by and Uploaded.
 */
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'

import { Section } from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'

export const Route = createFileRoute('/projects/$projectId/files')({
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

export async function fetchProjectFiles(
  client: DataClient,
  projectId: string,
): Promise<ProjectFile[]> {
  const records = await client.list<FileRecordWire>(
    'records',
    `?project_id=eq.${encodeURIComponent(projectId)}&kind=eq.file&deleted_at=is.null` +
      `&order=created_at.desc&limit=200&select=id,identifier,title,created_by_user_id,created_at`,
  )
  if (records.length === 0) return []
  const ids = records.map((record) => record.id)
  const objects = await client.list<FileObjectWire>(
    'file_objects',
    `?record_id=in.(${ids.map(encodeURIComponent).join(',')})` +
      `&select=record_id,display_name,media_type,byte_size`,
  )
  const byRecord = new Map(objects.map((object) => [object.record_id, object]))
  return records.map((record) => {
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
  const files = useQuery({
    queryKey: ['ui-port', 'project-files', projectId],
    queryFn: () => fetchProjectFiles(notebookDataClient, projectId),
  })
  const rows = files.data ?? []

  return (
    <Section title="Files">
      {rows.length === 0 ? (
        <EmptyState
          title="No files yet"
          body="Files uploaded to this project's records appear here."
        />
      ) : (
        <Table aria-label="Project files">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((file) => (
              <TableRow key={file.id}>
                <TableCell>
                  <Link
                    to="/records/$recordId"
                    params={{ recordId: file.id }}
                    className="hover:underline"
                  >
                    {file.name}
                  </Link>
                </TableCell>
                <TableCell>{formatKind(file.mediaType)}</TableCell>
                <TableCell align="right">{formatSize(file.byteSize)}</TableCell>
                <TableCell>{file.uploadedBy ?? '—'}</TableCell>
                <TableCell>{day(file.uploadedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  )
}
