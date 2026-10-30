#!/usr/bin/env node
/**
 * Puts the demo's instrument files into the app's own file storage (the database).
 *
 * The design seed records files that instruments sent, but it runs somewhere
 * other than the app, so the bytes would never reach the app's storage and
 * "Try again" on an intake problem would find nothing to read. This copies
 * them in at start-up. It only runs on the auth-free demo, and never
 * overwrites a file that is already there.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

if (process.env.SHEETBASE_DEV_AUTH_FREE !== 'true') process.exit(0)

const WORKSPACE = '00000000-0000-4000-8000-000000000300'
const here = dirname(fileURLToPath(import.meta.url))
const files = JSON.parse(
  await readFile(resolve(here, '../src/db/seed/demo-files.json'), 'utf8'),
)

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  for (const file of files) {
    const key = `${WORKSPACE}/${file.id}/${createHash('md5').update(file.id).digest('hex')}`
    const bytes = Buffer.from(file.text, 'utf8')
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO internal.file_blobs (storage_key, byte_size, checksum)
       VALUES ($1, $2, $3) ON CONFLICT (storage_key) DO NOTHING`,
      [key, bytes.length, createHash('sha256').update(bytes).digest('hex')],
    )
    if (inserted.rowCount) {
      await client.query(
        `INSERT INTO internal.file_blob_chunks (storage_key, seq, data)
         VALUES ($1, 0, $2)`,
        [key, bytes],
      )
    }
    await client.query('COMMIT')
  }
} finally {
  await client.end()
}
