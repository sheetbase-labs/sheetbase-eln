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

import { DatabaseObjectStorage } from './database'
import { S3ObjectStorage } from './s3'
import type { S3StorageConfig } from './s3'
import { MissingStorageObjectError, OversizeError } from './types'
import type { ObjectStorage, PutResult } from './types'

export * from './types'

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
    const handle = await open(target, 'wx', 0o600)
    let oversize = false
    try {
      const reader = body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        byteSize += BigInt(value.byteLength)
        if (byteSize > BigInt(maxBytes)) {
          oversize = true
          break
        }
        hash.update(value)
        await handle.write(value)
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

export type StorageBackendName = 'database' | 'local' | 's3'

export function s3ConfigFromEnv(): S3StorageConfig | null {
  if (!env.FILE_STORAGE_S3_BUCKET) return null
  return {
    bucket: env.FILE_STORAGE_S3_BUCKET,
    endpoint: env.FILE_STORAGE_S3_ENDPOINT,
    region: env.FILE_STORAGE_S3_REGION,
    accessKeyId: env.FILE_STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.FILE_STORAGE_S3_SECRET_ACCESS_KEY,
    pathStyle: env.FILE_STORAGE_S3_PATH_STYLE,
    prefix: env.FILE_STORAGE_S3_PREFIX,
  }
}

/** Build one named backend from the environment. */
export function createObjectStorage(name: StorageBackendName): ObjectStorage {
  if (name === 'local') return new LocalFileStorage()
  if (name === 'database') return new DatabaseObjectStorage()
  const config = s3ConfigFromEnv()
  if (!config) {
    throw new Error(
      'FILE_STORAGE_BACKEND=s3 needs FILE_STORAGE_S3_BUCKET (and, for a ' +
        'service other than AWS, FILE_STORAGE_S3_ENDPOINT plus the access key ' +
        'and secret).',
    )
  }
  return new S3ObjectStorage(config)
}

/**
 * Reads try the configured backend first, then any other backend that could
 * still hold the file. Switching backends therefore never makes files vanish
 * while they are being copied across (see `scripts/storage-copy.ts`). New
 * files are written, and removed files deleted, on every backend.
 */
export class ChainedObjectStorage implements ObjectStorage {
  constructor(
    private readonly primary: ObjectStorage,
    private readonly fallbacks: ObjectStorage[],
  ) {}

  putStream(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<PutResult> {
    return this.primary.putStream(storageKey, body, maxBytes)
  }

  async getStream(storageKey: string) {
    try {
      return await this.primary.getStream(storageKey)
    } catch (error) {
      if (!(error instanceof MissingStorageObjectError)) throw error
      for (const fallback of this.fallbacks) {
        try {
          return await fallback.getStream(storageKey)
        } catch (inner) {
          if (!(inner instanceof MissingStorageObjectError)) throw inner
        }
      }
      throw error
    }
  }

  async head(storageKey: string) {
    const found = await this.primary.head(storageKey)
    if (found) return found
    for (const fallback of this.fallbacks) {
      const other = await fallback.head(storageKey).catch(() => null)
      if (other) return other
    }
    return null
  }

  async delete(storageKey: string): Promise<void> {
    await this.primary.delete(storageKey)
    for (const fallback of this.fallbacks) {
      await fallback.delete(storageKey).catch(() => undefined)
    }
  }
}

/**
 * Returns the configured backend (database by default). The other backends
 * stay readable behind it so a switch can be made without losing access to
 * files that have not been copied yet.
 */
export function getObjectStorage(): ObjectStorage {
  if (cached) return cached
  const name = env.FILE_STORAGE_BACKEND
  const primary = createObjectStorage(name)
  const fallbacks: ObjectStorage[] = []
  for (const other of ['database', 'local', 's3'] as const) {
    if (other === name) continue
    if (other === 's3' && !s3ConfigFromEnv()) continue
    fallbacks.push(createObjectStorage(other))
  }
  cached = new ChainedObjectStorage(primary, fallbacks)
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
