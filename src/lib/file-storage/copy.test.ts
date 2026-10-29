import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { copyStoredFiles } from './copy'
import { MissingStorageObjectError } from './types'
import type { ObjectStorage } from './types'

function memory(initial: Record<string, string> = {}) {
  const objects = new Map(Object.entries(initial))
  const storage: ObjectStorage = {
    async putStream(key, body) {
      const reader = body.getReader()
      const parts: Buffer[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(Buffer.from(value))
      }
      const data = Buffer.concat(parts)
      objects.set(key, data.toString())
      return {
        byteSize: BigInt(data.length),
        checksum: createHash('sha256').update(data).digest('hex'),
      }
    },
    async getStream(key) {
      const found = objects.get(key)
      if (found === undefined) throw new MissingStorageObjectError(key)
      const bytes = Buffer.from(found)
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(bytes))
            c.close()
          },
        }),
        byteSize: bytes.length,
      }
    },
    async head(key) {
      const found = objects.get(key)
      return found === undefined ? null : { byteSize: found.length }
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { storage, objects }
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

describe('copyStoredFiles', () => {
  it('copies and verifies each file, and skips what is already there', async () => {
    const from = memory({ a: 'alpha', b: 'beta' })
    const to = memory({ b: 'beta' })
    const report = await copyStoredFiles(
      [
        { storageKey: 'a', checksum: sha('alpha'), byteSize: 5 },
        { storageKey: 'b', checksum: sha('beta'), byteSize: 4 },
      ],
      from.storage,
      to.storage,
      { maxBytes: 1000 },
    )
    expect(report).toMatchObject({ copied: 1, alreadyThere: 1, failed: [] })
    expect(to.objects.get('a')).toBe('alpha')
    expect(from.objects.size).toBe(2)
  })

  it('removes a copy that does not match the recorded checksum', async () => {
    const from = memory({ a: 'alpha' })
    const to = memory()
    const report = await copyStoredFiles(
      [{ storageKey: 'a', checksum: sha('different'), byteSize: 5 }],
      from.storage,
      to.storage,
      { maxBytes: 1000 },
    )
    expect(report.failed).toHaveLength(1)
    expect(to.objects.size).toBe(0)
    expect(from.objects.size).toBe(1)
  })

  it('reports files the source no longer has', async () => {
    const report = await copyStoredFiles(
      [{ storageKey: 'gone', checksum: null, byteSize: 1 }],
      memory().storage,
      memory().storage,
      { maxBytes: 1000 },
    )
    expect(report.missingFromSource).toEqual(['gone'])
  })

  it('only empties the source after a verified copy, and never on a dry run', async () => {
    const dry = memory({ a: 'alpha' })
    await copyStoredFiles(
      [{ storageKey: 'a', checksum: sha('alpha'), byteSize: 5 }],
      dry.storage,
      memory().storage,
      { maxBytes: 1000, dryRun: true, deleteSource: true },
    )
    expect(dry.objects.size).toBe(1)

    const from = memory({ a: 'alpha' })
    const to = memory()
    await copyStoredFiles(
      [{ storageKey: 'a', checksum: sha('alpha'), byteSize: 5 }],
      from.storage,
      to.storage,
      { maxBytes: 1000, deleteSource: true },
    )
    expect(from.objects.size).toBe(0)
    expect(to.objects.get('a')).toBe('alpha')
  })
})
