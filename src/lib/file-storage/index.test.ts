/** Unit tests for the SCI-003 object-storage abstraction and policy. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ChainedObjectStorage,
  LocalFileStorage,
  MissingStorageObjectError,
  OversizeError,
  generateStorageKey,
  newFileObjectId,
  setObjectStorageForTesting,
} from '#/lib/file-storage'
import type { ObjectStorage } from '#/lib/file-storage'
import {
  ALLOWED_MEDIA_TYPES,
  FILE_MAX_BYTES,
  isAllowedMediaType,
  isInlinePreviewableImage,
  validateUploadRequest,
} from '#/lib/file-policy'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('file-policy', () => {
  it('admits the allowed scientific media types and rejects others', () => {
    expect(isAllowedMediaType('text/csv')).toBe(true)
    expect(isAllowedMediaType('application/pdf')).toBe(true)
    expect(isAllowedMediaType('application/x-evil')).toBe(false)
  })

  it('previews raster images inline but not TIFF', () => {
    expect(isInlinePreviewableImage('image/png')).toBe(true)
    expect(isInlinePreviewableImage('image/tiff')).toBe(false)
    expect(isInlinePreviewableImage('application/pdf')).toBe(false)
  })

  it('caps byte size at 100 MiB', () => {
    expect(FILE_MAX_BYTES).toBe(104_857_600)
  })

  it('validates a correct authorization request', () => {
    const res = validateUploadRequest({
      displayName: 'run07.csv',
      mediaType: 'text/csv',
      byteSize: 1024,
      checksum: 'a'.repeat(64),
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.displayName).toBe('run07.csv')
      expect(res.value.byteSize).toBe(1024)
    }
  })

  it('rejects an oversized file, disallowed type, and bad checksum', () => {
    const res = validateUploadRequest({
      displayName: 'big.bin',
      mediaType: 'application/x-evil',
      byteSize: FILE_MAX_BYTES + 1,
      checksum: 'not-hex',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.violations.map((v) => v.field)).toContain('byteSize')
      expect(res.violations.map((v) => v.field)).toContain('mediaType')
    }
  })

  it('rejects an empty display name', () => {
    const res = validateUploadRequest({
      displayName: '   ',
      mediaType: 'text/csv',
      byteSize: 10,
    })
    expect(res.ok).toBe(false)
  })

  it('accepts a null checksum', () => {
    const res = validateUploadRequest({
      displayName: 'ok.csv',
      mediaType: 'text/csv',
      byteSize: 10,
    })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.checksum).toBeNull()
  })
})

describe('LocalFileStorage', () => {
  let dir: string
  let storage: LocalFileStorage

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sheetbase-storage-'))
    storage = new LocalFileStorage(dir)
    setObjectStorageForTesting(storage)
  })

  afterEach(async () => {
    setObjectStorageForTesting(null)
    await rm(dir, { recursive: true, force: true })
  })

  it('streams bytes to disk and reports size + sha256', async () => {
    const ws = '00000000-0000-4000-8000-000000000001'
    const objId = newFileObjectId()
    const key = generateStorageKey(ws, objId)
    const payload = new TextEncoder().encode('hello sheetbase')
    const result = await storage.putStream(key, streamOf(payload), 1024)
    expect(result.byteSize).toBe(BigInt(payload.byteLength))
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/)
    const written = await readFile(join(dir, key))
    expect(written.toString()).toBe('hello sheetbase')
  })

  it('never overwrites an existing storage key', async () => {
    const ws = '00000000-0000-4000-8000-000000000005'
    const key = generateStorageKey(ws, newFileObjectId())
    const original = new TextEncoder().encode('submitted bytes')
    await storage.putStream(key, streamOf(original), 1024)

    await expect(
      storage.putStream(
        key,
        streamOf(new TextEncoder().encode('replacement bytes')),
        1024,
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect((await readFile(join(dir, key))).toString()).toBe('submitted bytes')
  })

  it('aborts and removes the partial object when the cap is exceeded', async () => {
    const ws = '00000000-0000-4000-8000-000000000002'
    const key = generateStorageKey(ws, newFileObjectId())
    const payload = new TextEncoder().encode('x'.repeat(64))
    await expect(
      storage.putStream(key, streamOf(payload), 10),
    ).rejects.toBeInstanceOf(OversizeError)
    // The partial object must not remain.
    expect(await storage.head(key)).toBeNull()
  })

  it('reads a stored object back as a stream', async () => {
    const ws = '00000000-0000-4000-8000-000000000003'
    const key = generateStorageKey(ws, newFileObjectId())
    const payload = new TextEncoder().encode('stream me back')
    await storage.putStream(key, streamOf(payload), 1024)
    const { stream, byteSize } = await storage.getStream(key)
    const reader = stream.getReader()
    let acc = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      acc += new TextDecoder().decode(value)
    }
    expect(acc).toBe('stream me back')
    expect(byteSize).toBe(payload.byteLength)
  })

  it('reports missing objects honestly', async () => {
    const key = generateStorageKey(
      '00000000-0000-4000-8000-000000000004',
      newFileObjectId(),
    )
    expect(await storage.head(key)).toBeNull()
    await expect(storage.getStream(key)).rejects.toBeInstanceOf(
      MissingStorageObjectError,
    )
  })

  it('generates a storage key independent of the user filename', () => {
    const ws = '00000000-0000-4000-8000-000000000005'
    const obj = newFileObjectId()
    const key = generateStorageKey(ws, obj)
    expect(key).toMatch(/^[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f]{32}$/)
    expect(key).not.toContain('userfile.csv')
  })
})

describe('allowed media type list', () => {
  it('includes octet-stream so instrument binaries are not silently rejected', () => {
    expect(ALLOWED_MEDIA_TYPES).toContain('application/octet-stream')
  })
})

describe('ChainedObjectStorage', () => {
  const memory = (initial: Record<string, string> = {}) => {
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
        return { byteSize: BigInt(data.length), checksum: 'x' }
      },
      async getStream(key) {
        const found = objects.get(key)
        if (found === undefined) throw new MissingStorageObjectError(key)
        const bytes = Buffer.from(found)
        return { stream: streamOf(bytes), byteSize: bytes.length }
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

  it('writes to the configured backend and still reads files left on the old one', async () => {
    const primary = memory()
    const old = memory({ 'old/key': 'kept' })
    const chain = new ChainedObjectStorage(primary.storage, [old.storage])
    await chain.putStream('new/key', streamOf(Buffer.from('fresh')), 100)
    expect([...primary.objects.keys()]).toEqual(['new/key'])
    expect(old.objects.has('new/key')).toBe(false)
    const read = await chain.getStream('old/key')
    expect(
      Buffer.from(await new Response(read.stream).arrayBuffer()).toString(),
    ).toBe('kept')
    expect(await chain.head('old/key')).toEqual({ byteSize: 4 })
    await expect(chain.getStream('nowhere')).rejects.toBeInstanceOf(
      MissingStorageObjectError,
    )
  })

  it('removes a file from every backend', async () => {
    const primary = memory({ k: 'a' })
    const old = memory({ k: 'a' })
    const chain = new ChainedObjectStorage(primary.storage, [old.storage])
    await chain.delete('k')
    expect(primary.objects.size + old.objects.size).toBe(0)
  })
})
