/** Real PostgreSQL: files kept in the database come back byte for byte. */
import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Client } from 'pg'

import { getPool } from '#/db/pool.server'
import { DatabaseObjectStorage, CHUNK_BYTES } from '#/lib/file-storage/database'
import {
  MissingStorageObjectError,
  OversizeError,
} from '#/lib/file-storage/types'
import { migratorUrl, prepareTestDatabase } from './helpers'

let admin: Client
let storage: DatabaseObjectStorage
const key = () =>
  `${crypto.randomUUID()}/${crypto.randomUUID()}/${randomBytes(16).toString('hex')}`

function streamOf(...parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

beforeAll(async () => {
  admin = (await prepareTestDatabase()).migrator
  storage = new DatabaseObjectStorage(getPool(migratorUrl()))
})

afterAll(async () => {
  await getPool(migratorUrl()).end()
  await admin?.end()
})

it('stores a file larger than one piece and reads it back identically', async () => {
  const bytes = randomBytes(CHUNK_BYTES * 2 + 12345)
  const k = key()
  // Deliver in awkward slices so pieces straddle stream chunks.
  const slices = [
    bytes.subarray(0, 777),
    bytes.subarray(777, CHUNK_BYTES + 5),
    bytes.subarray(CHUNK_BYTES + 5),
  ]
  const result = await storage.putStream(k, streamOf(...slices), 10_000_000)
  expect(result.byteSize).toBe(BigInt(bytes.length))
  expect(result.checksum).toBe(createHash('sha256').update(bytes).digest('hex'))
  expect(await storage.head(k)).toEqual({ byteSize: bytes.length })
  const read = await storage.getStream(k)
  expect(read.byteSize).toBe(bytes.length)
  expect((await readAll(read.stream)).equals(bytes)).toBe(true)
})

it('stores an empty file', async () => {
  const k = key()
  const result = await storage.putStream(k, streamOf(), 100)
  expect(result.byteSize).toBe(0n)
  const read = await storage.getStream(k)
  expect((await readAll(read.stream)).length).toBe(0)
})

it('refuses an oversized upload and leaves nothing behind', async () => {
  const k = key()
  await expect(
    storage.putStream(k, streamOf(randomBytes(500)), 100),
  ).rejects.toBeInstanceOf(OversizeError)
  expect(await storage.head(k)).toBeNull()
  const { rows } = await admin.query(
    'SELECT count(*)::int AS n FROM internal.file_blob_chunks WHERE storage_key = $1',
    [k],
  )
  expect(rows[0].n).toBe(0)
})

it('never overwrites an existing object', async () => {
  const k = key()
  await storage.putStream(k, streamOf(Buffer.from('first')), 100)
  await expect(
    storage.putStream(k, streamOf(Buffer.from('second')), 100),
  ).rejects.toThrow()
  const read = await storage.getStream(k)
  expect((await readAll(read.stream)).toString()).toBe('first')
})

it('reports a missing object and deletes idempotently', async () => {
  const k = key()
  await expect(storage.getStream(k)).rejects.toBeInstanceOf(
    MissingStorageObjectError,
  )
  await storage.putStream(k, streamOf(Buffer.from('x')), 100)
  await storage.delete(k)
  await storage.delete(k)
  expect(await storage.head(k)).toBeNull()
})
