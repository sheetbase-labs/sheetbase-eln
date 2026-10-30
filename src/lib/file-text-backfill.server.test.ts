// @vitest-environment node
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import type { ObjectStorage } from './file-storage'
import type { BackfillConnection } from './file-text-backfill.server'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const { backfillFileText } = await import('./file-text-backfill.server')

const ODT = 'application/vnd.oasis.opendocument.text'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('backfillFileText', () => {
  it('stores text, marks empty and unreadable files, and walks every batch', async () => {
    const odt = zipSync({
      'content.xml': strToU8('<text:p>Quarterly stability</text:p>'),
    })
    const files = [
      { id: '00000000-0000-4000-8000-000000000001', key: 'a', type: ODT },
      {
        id: '00000000-0000-4000-8000-000000000002',
        key: 'b',
        type: 'text/plain',
      },
      { id: '00000000-0000-4000-8000-000000000003', key: 'c', type: ODT },
    ]
    const bodies: Record<string, Uint8Array | null> = {
      a: odt,
      b: strToU8('   '),
      c: null,
    }
    const storage = {
      getStream: async (key: string) => {
        const body = bodies[key]
        if (!body) throw new Error('missing object')
        return { stream: streamOf(body) }
      },
    } as unknown as ObjectStorage
    const updates: unknown[][] = []
    const done = new Set<string>()
    const conn: BackfillConnection = {
      query: (async (text: string, values: unknown[] = []) => {
        if (text.includes('SELECT')) {
          const after = values[2] as string | null
          const rows = files
            .filter((f) => !done.has(f.id) && (!after || f.id > after))
            .slice(0, values[3] as number)
            .map((f) => ({ id: f.id, storage_key: f.key, media_type: f.type }))
          return { rows }
        }
        updates.push(values)
        done.add(values[0] as string)
        return { rows: [] }
      }) as BackfillConnection['query'],
      end: async () => {},
    }
    const result = await backfillFileText(conn, storage, { limit: 2 })
    expect(result).toEqual({ scanned: 3, stored: 1, empty: 1, failed: 1 })
    expect(updates).toEqual([
      [files[0].id, true, 'Quarterly stability'],
      [files[1].id, false, null],
      [files[2].id, false, null],
    ])
  })
})
