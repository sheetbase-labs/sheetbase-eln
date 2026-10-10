/**
 * PROJ-04.4 — the project files tab's data layer.
 *
 * A file is a record of kind 'file' with a 1:1 api.file_objects row, so the tab lists
 * the project's file records and joins their object metadata for the name, kind and
 * size columns.
 */
import { describe, expect, it, vi } from 'vitest'

import { fetchProjectFiles } from '#/routes/projects/$projectId/files'
import type { DataClient } from '#/lib/data-client'

const PROJECT = '00000000-0000-4000-8000-000000090010'

function client(records: unknown[], objects: unknown[]): DataClient {
  const list = vi
    .fn()
    .mockResolvedValueOnce(records)
    .mockResolvedValueOnce(objects)
  return { list } as unknown as DataClient
}

describe('fetchProjectFiles', () => {
  it('joins each file record with its object metadata', async () => {
    const rows = await fetchProjectFiles(
      client(
        [
          {
            id: 'rec-1',
            identifier: 'FILE-0001',
            title: 'fallback name',
            created_by_user_id: 'gareth',
            created_at: '2026-09-24T09:00:00Z',
          },
        ],
        [
          {
            record_id: 'rec-1',
            display_name: 'PR-01_EXP-0142_plates1-3.xlsx',
            media_type:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            byte_size: 219_136,
          },
        ],
      ),
      PROJECT,
    )
    expect(rows).toEqual([
      {
        id: 'rec-1',
        identifier: 'FILE-0001',
        name: 'PR-01_EXP-0142_plates1-3.xlsx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: 219_136,
        uploadedBy: 'gareth',
        uploadedAt: '2026-09-24T09:00:00Z',
      },
    ])
  })

  it('falls back to the record title when the object metadata is absent', async () => {
    const rows = await fetchProjectFiles(
      client(
        [
          {
            id: 'rec-2',
            identifier: 'FILE-0002',
            title: 'uploaded.csv',
            created_by_user_id: null,
            created_at: '2026-09-24T09:00:00Z',
          },
        ],
        [],
      ),
      PROJECT,
    )
    expect(rows[0]).toMatchObject({ name: 'uploaded.csv', byteSize: null })
  })

  it('returns nothing, and asks for no objects, when the project has no files', async () => {
    const list = vi.fn().mockResolvedValueOnce([])
    const rows = await fetchProjectFiles(
      { list } as unknown as DataClient,
      PROJECT,
    )
    expect(rows).toEqual([])
    expect(list).toHaveBeenCalledTimes(1)
  })
})
