import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'

/** One stored version of a file, oldest first in the list. */
export interface StoredFileVersion {
  /** The server's version counter; what `?version=` on a download takes. */
  version: number
  displayName: string
  mediaType: string
  byteSize: number
  createdAt: string
  status: string
}

interface VersionWire {
  version: number
  display_name: string
  media_type: string
  byte_size: number | string
  created_at: string
  status: string
}

export const fileVersionsKey = (fileRecordId: string) =>
  ['notebook', 'file-versions', fileRecordId] as const

export async function fetchFileVersions(
  fileRecordId: string,
): Promise<StoredFileVersion[]> {
  const rows = await notebookDataClient.list<VersionWire>(
    'file_objects',
    `?record_id=eq.${encodeURIComponent(fileRecordId)}&select=version,display_name,media_type,byte_size,created_at,status&order=version.asc`,
  )

  return rows.map((row) => ({
    version: row.version,
    displayName: row.display_name,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    createdAt: row.created_at,
    status: row.status,
  }))
}

export function useFileVersions(fileRecordId: string) {
  return useQuery({
    queryKey: fileVersionsKey(fileRecordId),
    queryFn: () => fetchFileVersions(fileRecordId),
    enabled: Boolean(fileRecordId),
    staleTime: 15_000,
  })
}

/** The version a block shows, and whether a newer one has been added since. */
export function resolveBlockVersion(
  versions: readonly StoredFileVersion[],
  pinned: number | null,
) {
  const usable = versions.filter((v) => v.status !== 'deleted')
  const latest = usable.length > 0 ? usable[usable.length - 1] : null

  const pinnedRow =
    pinned === null ? null : (usable.find((v) => v.version === pinned) ?? null)

  const shown = pinnedRow ?? latest
  const position = shown ? usable.indexOf(shown) + 1 : 0

  const newer =
    pinnedRow && latest && latest.version > pinnedRow.version ? latest : null

  return { shown, latest, position, count: usable.length, newer }
}

const filePin = z.object({ fileVersion: z.number().int().positive().optional() })

/** The pinned version a file block's payload carries, if any. */
export function pinnedVersionOf(payload: NotebookBlock['payload']) {
  const parsed = filePin.safeParse(payload)

  return parsed.success ? (parsed.data.fileVersion ?? null) : null
}
