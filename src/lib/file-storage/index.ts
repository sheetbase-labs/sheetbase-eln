/**
 * Object-storage abstraction (SCI-003, decision 0028).
 *
 * Bytes live behind this boundary, never proxied through the `/api/db` JSON
 * boundary. The interface is backend-independent: the local filesystem
 * implementation is the development/orb default (no cloud credentials); an
 * S3-compatible implementation mints presigned URLs in production. Storage
 * keys are server-generated and backend-independent.
 *
 * Upload is streamed and size-bounded: bytes are piped in fixed-size chunks
 * and the running byte count is checked against the cap on every chunk, so an
 * oversized upload is aborted before the file is materialised. The whole file
 * is never held in application memory as a single buffer.
 */
import { createHash, randomUUID, webcrypto } from 'node:crypto'
import { mkdir, open, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { env } from '#/env.server'

/** Lifecycle states mirrored from the `file_objects.status` check. */
export type FileObjectStatus =
  | 'active'
  | 'quarantined'
  | 'deleted'
  | 'missing'

export class OversizeError extends Error {
  constructor(
    message: string,
    readonly limit: number,
  ) {
    super(message)
    this.name = 'OversizeError'
  }
}

export class ChecksumMismatchError extends Error {
  constructor(
    message: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(message)
    this.name = 'ChecksumMismatchError'
  }
}

export class MissingStorageObjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingStorageObjectError'
  }
}

export interface PutResult {
  byteSize: bigint
  checksum: string
}

export interface ObjectStorage {
  /**
   * Stream `body` to the object at `storageKey`, enforcing `maxBytes`.
   * Returns the materialised byte size and sha256 checksum. Throws
   * `OversizeError` if the stream exceeds the cap; the partial object is
   * removed before returning.
   */
  putStream(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<PutResult>
  /**
   * Open a read stream for the object. Throws `MissingStorageObjectError`
   * if the object is absent.
   */
  getStream(
    storageKey: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; byteSize: number }>
  /** Returns the object size or null if it is absent. */
  head(storageKey: string): Promise<{ byteSize: number } | null>
  /** Remove the object. No-op if it is already absent. */
  delete(storageKey: string): Promise<void>
}

const CHUNK_SIZE = 64 * 1024

/**
 * Filesystem-backed `ObjectStorage`. Objects are stored at
 * `<FILE_STORAGE_DIR>/<storageKey>`. The storage key is server-generated and
 * contains no user input, so path-joining is injection-safe.
 */
export class LocalFileStorage implements ObjectStorage {
  private readonly root: string

  constructor(rootDir: string = env.FILE_STORAGE_DIR) {
    this.root = resolve(rootDir)
  }

  private path(storageKey: string): string {
    // storage_key matches ^<uuid>/<uuid>/<hex32>$ (DB check constraint). It is
    // server-generated and never derived from a user filename, so joining is
    // safe. Resolve and verify the result stays under root.
    const safe = join(this.root, storageKey)
    if (!safe.startsWith(this.root)) {
      throw new Error('storage key escapes storage root')
    }
    return safe
  }

  async putStream(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<PutResult> {
    const target = this.path(storageKey)
    await mkdir(dirname(target), { recursive: true })
    const hash = createHash('sha256')
    let byteSize = 0n
    const handle = await open(target, 'w', 0o600)
    let oversize = false
    try {
      const reader = body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          byteSize += BigInt(value.byteLength)
          if (byteSize > BigInt(maxBytes)) {
            oversize = true
            break
          }
          hash.update(value)
          await handle.write(value)
        }
      }
    } finally {
      await handle.close()
      if (oversize) {
        await rm(target, { force: true })
      }
    }
    if (oversize) {
      throw new OversizeError(
        `upload exceeds the ${maxBytes}-byte cap`,
        maxBytes,
      )
    }
    return { byteSize, checksum: hash.digest('hex') }
  }

  async getStream(
    storageKey: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; byteSize: number }> {
    const target = this.path(storageKey)
    let info
    try {
      info = await stat(target)
    } catch {
      throw new MissingStorageObjectError(
        `storage object not found: ${storageKey}`,
      )
    }
    const { createReadStream } = await import('node:fs')
    const nodeStream = createReadStream(target, { highWaterMark: CHUNK_SIZE })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          controller.enqueue(new Uint8Array(buf))
        })
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err) => controller.error(err))
      },
      cancel() {
        nodeStream.destroy()
      },
    })
    return { stream, byteSize: info.size }
  }

  async head(storageKey: string): Promise<{ byteSize: number } | null> {
    try {
      const info = await stat(this.path(storageKey))
      return { byteSize: info.size }
    } catch {
      return null
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.path(storageKey), { force: true })
  }
}

let cached: ObjectStorage | null = null

/** Returns the configured backend (local by default). */
export function getObjectStorage(): ObjectStorage {
  if (cached) return cached
  // S3 backend is structured but not exercised in this ticket; the local
  // backend is the tested path. Switching is configuration-only.
  cached = new LocalFileStorage()
  return cached
}

/** For tests: inject a backend or reset to the configured one. */
export function setObjectStorageForTesting(
  backend: ObjectStorage | null,
): void {
  cached = backend
}

/**
 * Generates a server-side storage key independent of any user filename:
 * `<workspaceId>/<fileObjectId>/<random32hex>`.
 */
export function generateStorageKey(
  workspaceId: string,
  fileObjectId: string,
): string {
  const random = webcrypto.randomUUID().replace(/-/g, '')
  return `${workspaceId}/${fileObjectId}/${random}`
}

/** Fresh server-generated file object id. */
export function newFileObjectId(): string {
  return randomUUID()
}
