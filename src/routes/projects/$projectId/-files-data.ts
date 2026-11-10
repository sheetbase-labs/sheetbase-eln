import { formatDate } from '#/lib/format-date'
import type { DataClient } from '#/lib/data-client'
import {
  PROJECT_LIST_PAGE_SIZE,
  projectPageOffset,
} from '#/components/projects/project-lists'
import { getFileType } from '#/components/reui/file-type'
import { t } from '#/copy'

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
    uploaded: formatDate(file.uploadedAt),
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

  // The short name a scientist knows (XLSX, PDF); a long subtype that maps to
  // nothing reads as its family (Image, Text) rather than the whole string.
  const key = getFileType(mediaType)

  if (key !== 'empty' && key.length <= 6) return key.toUpperCase()

  const family = mediaType.split('/')[0]

  return family && family !== 'application'
    ? family.charAt(0).toUpperCase() + family.slice(1)
    : t('projects.projectFiles.otherKind')
}
