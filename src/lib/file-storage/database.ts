/**
 * Database-backed `ObjectStorage`: the default. Bytes are kept in one-megabyte
 * pieces in `internal.file_blob_chunks`, so a deploy, a new container or a
 * restore never separates files from the records that point at them, and a
 * database backup covers both.
 */
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'

import { getPool } from '#/db/pool.server'
import { env } from '#/env.server'

import { MissingStorageObjectError, OversizeError } from './types'
import type { ObjectStorage, PutResult } from './types'

export const CHUNK_BYTES = 1024 * 1024

export class DatabaseObjectStorage implements ObjectStorage {
  private readonly pool: Pool

  constructor(pool: Pool = getPool(env.DATABASE_URL)) {
    this.pool = pool
  }

  async putStream(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ): Promise<PutResult> {
    const client = await this.pool.connect()
    let finished = false
    try {
      await client.query('BEGIN')
      // The size and checksum are only known once the stream ends, so the
      // header row is written first with placeholders and completed after.
      await client.query(
        `INSERT INTO internal.file_blobs (storage_key, byte_size, checksum)
         VALUES ($1, 0, repeat('0', 64))`,
        [storageKey],
      )
      const hash = createHash('sha256')
      let byteSize = 0n
      let seq = 0
      let pending: Buffer[] = []
      let pendingBytes = 0
      const flush = async (final: boolean) => {
        while (pendingBytes >= CHUNK_BYTES || (final && pendingBytes > 0)) {
          const joined = Buffer.concat(pending)
          const piece = joined.subarray(0, CHUNK_BYTES)
          const rest = joined.subarray(piece.length)
          await client.query(
            `INSERT INTO internal.file_blob_chunks (storage_key, seq, data)
             VALUES ($1, $2, $3)`,
            [storageKey, seq++, piece],
          )
          pending = rest.length ? [rest] : []
          pendingBytes = rest.length
        }
      }
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
        pending.push(
          Buffer.from(value.buffer, value.byteOffset, value.byteLength),
        )
        pendingBytes += value.byteLength
        await flush(false)
      }
      await flush(true)
      const checksum = hash.digest('hex')
      await client.query(
        `UPDATE internal.file_blobs SET byte_size = $2, checksum = $3
          WHERE storage_key = $1`,
        [storageKey, byteSize.toString(), checksum],
      )
      await client.query('COMMIT')
      finished = true
      return { byteSize, checksum }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release(!finished)
    }
  }

  async getStream(
    storageKey: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; byteSize: number }> {
    const head = await this.head(storageKey)
    if (!head) {
      throw new MissingStorageObjectError(
        `storage object not found: ${storageKey}`,
      )
    }
    const pool = this.pool
    let seq = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { rows } = await pool.query<{ data: Buffer }>(
            `SELECT data FROM internal.file_blob_chunks
              WHERE storage_key = $1 AND seq = $2`,
            [storageKey, seq],
          )
          if (rows.length === 0) {
            controller.close()
            return
          }
          seq += 1
          const data = rows[0].data
          controller.enqueue(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          )
        } catch (error) {
          controller.error(error)
        }
      },
    })
    return { stream, byteSize: head.byteSize }
  }

  async head(storageKey: string): Promise<{ byteSize: number } | null> {
    const { rows } = await this.pool.query<{ byte_size: string }>(
      `SELECT byte_size::text FROM internal.file_blobs WHERE storage_key = $1`,
      [storageKey],
    )
    return rows[0] ? { byteSize: Number(rows[0].byte_size) } : null
  }

  async delete(storageKey: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM internal.file_blobs WHERE storage_key = $1`,
      [storageKey],
    )
  }
}
