/**
 * S3-compatible `ObjectStorage`: AWS S3, Cloudflare R2, Backblaze B2, Garage,
 * SeaweedFS or any service that speaks the S3 API. Only plain object
 * PUT/GET/HEAD/DELETE are used, so nothing here is specific to one provider.
 *
 * An upload is first spooled to a temporary file while it is counted against
 * the size cap and hashed, then sent with its exact length. That keeps memory
 * flat and lets the service verify the bytes it receives.
 */
import { createReadStream } from 'node:fs'
import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { MissingStorageObjectError, OversizeError } from './types'
import type { ObjectStorage, PutResult } from './types'

export interface S3StorageConfig {
  bucket: string
  endpoint?: string
  region: string
  accessKeyId?: string
  secretAccessKey?: string
  pathStyle: boolean
  prefix: string
}

function isNotFound(error: unknown): boolean {
  const e = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  } | null
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  )
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string

  constructor(config: S3StorageConfig, client?: S3Client) {
    this.bucket = config.bucket
    this.prefix = config.prefix ? `${config.prefix.replace(/\/+$/, '')}/` : ''
    this.client =
      client ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.pathStyle,
        credentials:
          config.accessKeyId && config.secretAccessKey
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              }
            : undefined,
        // Some S3-compatible services reject the newer default checksum headers.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      })
  }

  private key(storageKey: string): string {
    return `${this.prefix}${storageKey}`
  }

  async putStream(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<PutResult> {
    const dir = await mkdtemp(join(tmpdir(), 'sheetbase-upload-'))
    const spool = join(dir, 'object')
    try {
      const hash = createHash('sha256')
      let byteSize = 0n
      const handle = await open(spool, 'w', 0o600)
      try {
        const reader = body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          byteSize += BigInt(value.byteLength)
          if (byteSize > BigInt(maxBytes)) {
            await reader.cancel().catch(() => undefined)
            throw new OversizeError(
              `upload exceeds the ${maxBytes}-byte cap`,
              maxBytes,
            )
          }
          hash.update(value)
          await handle.write(value)
        }
      } finally {
        await handle.close()
      }
      const checksum = hash.digest('hex')
      const { size } = await stat(spool)
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(storageKey),
          Body: createReadStream(spool),
          ContentLength: size,
          Metadata: { sha256: checksum },
        }),
      )
      return { byteSize, checksum }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async getStream(
    storageKey: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; byteSize: number }> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.key(storageKey),
        }),
      )
      if (!response.Body) {
        throw new MissingStorageObjectError(
          `storage object not found: ${storageKey}`,
        )
      }
      return {
        stream:
          response.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        byteSize: Number(response.ContentLength ?? 0),
      }
    } catch (error) {
      if (isNotFound(error)) {
        throw new MissingStorageObjectError(
          `storage object not found: ${storageKey}`,
        )
      }
      throw error
    }
  }

  async head(storageKey: string): Promise<{ byteSize: number } | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.key(storageKey),
        }),
      )
      return { byteSize: Number(response.ContentLength ?? 0) }
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  async delete(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.key(storageKey),
      }),
    )
  }
}
