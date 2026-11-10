/**
 * PROJ-04.4 — the project files tab's data layer.
 *
 * A file is a record of kind 'file' with a 1:1 api.file_objects row, so the tab lists
 * the project's file records and joins their object metadata for the name, kind and
 * size columns. The read is paged and reports the project's total, so a project with
 * more files than one page never silently drops the rest.
 */
import { describe, expect, it } from 'vitest'

import { fetchProjectFilesPage, toFileDisplayRows } from './-files-data'
import { createDataClient } from '#/lib/data-client'

const PROJECT = '00000000-0000-4000-8000-000000090010'

interface FileRecordFixture {
  id: string
  identifier: string
  title: string
  created_by_user_id: string | null
  created_at: string
}

interface FileObjectFixture {
  record_id: string
  display_name: string
  media_type: string
  byte_size: number
}

function client(
  records: FileRecordFixture[],
  objects: FileObjectFixture[],
  total = records.length,
) {
  const reads: URL[] = []
  const counts: URL[] = []

  const dataClient = createDataClient(async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    )

    if (new Headers(init?.headers).has('range')) {
      counts.push(url)

      return Response.json([], {
        headers: { 'content-range': total ? `0-0/${total}` : '*/0' },
      })
    }

    reads.push(url)

    return Response.json(
      url.pathname.endsWith('/file_objects') ? objects : records,
    )
  })

  return { dataClient, reads, counts }
}

describe('fetchProjectFilesPage', () => {
  it('joins each file record with its object metadata and reports the total', async () => {
    const page = await fetchProjectFilesPage(
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
        240,
      ).dataClient,
      PROJECT,
      1,
    )

    expect(page).toEqual({
      page: 1,
      total: 240,
      rows: [
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
      ],
    })
  })

  it('falls back to the record title when the object metadata is absent', async () => {
    const page = await fetchProjectFilesPage(
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
      ).dataClient,
      PROJECT,
      1,
    )

    expect(page.rows[0]).toMatchObject({ name: 'uploaded.csv', byteSize: null })
  })

  it('reads the requested page, bounded, and counts the whole project', async () => {
    const fixture = client([], [], 240)
    await fetchProjectFilesPage(fixture.dataClient, PROJECT, 2)
    expect(fixture.reads).toHaveLength(1)
    expect(fixture.reads[0].searchParams.get('limit')).toBe('25')
    expect(fixture.reads[0].searchParams.get('offset')).toBe('25')
    expect(fixture.counts).toHaveLength(1)
  })

  it('returns nothing, and asks for no objects, when the page has no records', async () => {
    const fixture = client([], [], 0)
    const page = await fetchProjectFilesPage(fixture.dataClient, PROJECT, 1)
    expect(page.rows).toEqual([])
    expect(page.total).toBe(0)
    expect(fixture.reads).toHaveLength(1)
    expect(fixture.reads[0].pathname).toBe('/api/db/records')
  })
})

describe('toFileDisplayRows', () => {
  it('names the uploader, never their raw id, and shows an em dash when unknown', () => {
    const rows = toFileDisplayRows(
      [
        {
          id: 'rec-1',
          identifier: 'FILE-0001',
          name: 'plates.xlsx',
          mediaType: null,
          byteSize: 1024,
          uploadedBy: '00000000-0000-4000-8000-000000000009',
          uploadedAt: '2026-09-24T09:00:00Z',
        },
        {
          id: 'rec-2',
          identifier: 'FILE-0002',
          name: 'notes.pdf',
          mediaType: null,
          byteSize: null,
          uploadedBy: null,
          uploadedAt: '2026-09-24T09:00:00Z',
        },
      ],
      (userId) =>
        userId === '00000000-0000-4000-8000-000000000009'
          ? 'Gareth P.'
          : userId,
    )

    expect(rows.map((row) => row.uploadedBy)).toEqual(['Gareth P.', '—'])
  })
})
