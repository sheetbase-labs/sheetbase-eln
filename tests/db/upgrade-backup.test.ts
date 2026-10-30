/**
 * Real PostgreSQL: an upgrade with migrations to apply backs every workspace up
 * first and stops if it cannot; one with nothing to apply, or a first install,
 * does not.
 */
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getPool } from '#/db/pool.server'
import { MissingStorageObjectError } from '#/lib/file-storage/types'
import type { ObjectStorage } from '#/lib/file-storage/types'
import type { ArchiveConnection } from '#/lib/workspace-export/archive.server'
import type { BackupDeps } from '#/lib/workspace-export/backup.server'
import {
  backupBeforeUpgrade,
  pendingMigrationCount,
} from '#/lib/workspace-export/upgrade-backup.server'
import type { MigrationJournal } from '#/lib/workspace-export/upgrade-backup.server'
import { migratorUrl, prepareTestDatabase } from './helpers'

const WS_1 = '00000000-0000-4000-8000-0000000049e1'
const WS_2 = '00000000-0000-4000-8000-0000000049e2'

const journal = JSON.parse(
  readFileSync('drizzle/meta/_journal.json', 'utf8'),
) as MigrationJournal
const withNewerMigration: MigrationJournal = {
  entries: [
    ...journal.entries,
    { when: journal.entries.at(-1)!.when + 1_000, tag: '9999_next' },
  ],
}

let migrator: Client

function storage(failPuts = false) {
  const objects = new Map<string, Buffer>()
  const store: ObjectStorage = {
    async putStream(key, body) {
      if (failPuts) throw new Error('bucket unreachable')
      const parts: Buffer[] = []
      const reader = body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(Buffer.from(value))
      }
      const data = Buffer.concat(parts)
      objects.set(key, data)
      return { byteSize: BigInt(data.length), checksum: 'a'.repeat(64) }
    },
    async getStream(key) {
      throw new MissingStorageObjectError(key)
    },
    async head(key) {
      return objects.has(key) ? { byteSize: objects.get(key)!.length } : null
    },
    async delete(key) {
      objects.delete(key)
    },
  }
  return { store, objects }
}

const connect = async (): Promise<ArchiveConnection> => {
  const client = new Client({ connectionString: migratorUrl() })
  await client.connect()
  return client
}

function deps(destination: ObjectStorage): BackupDeps {
  return {
    pool: getPool(migratorUrl()),
    archive: { connect, storage: destination },
    destination: { name: 'database', separate: false, storage: destination },
    now: () => new Date(),
  }
}

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator.end()
})

describe('backup before an upgrade', () => {
  it('counts the migrations the database has not applied', async () => {
    const pool = getPool(migratorUrl())
    expect(await pendingMigrationCount(pool, journal)).toBe(0)
    expect(await pendingMigrationCount(pool, withNewerMigration)).toBe(1)
  })

  it('treats a database that was never migrated as a first install', async () => {
    const pool = { query: async () => ({ rows: [{ present: false }] }) }
    expect(await pendingMigrationCount(pool as never, journal)).toBeNull()
  })

  it('does nothing when there is nothing to apply', async () => {
    const { store, objects } = storage()
    const outcome = await backupBeforeUpgrade(deps(store), journal)
    expect(outcome).toEqual({ status: 'not_needed', reason: 'up_to_date' })
    expect(objects.size).toBe(0)
  })

  it('has nothing to protect in a database with no workspace', async () => {
    const { store } = storage()
    const outcome = await backupBeforeUpgrade(deps(store), withNewerMigration)
    expect(outcome).toEqual({ status: 'not_needed', reason: 'no_data' })
  })

  it('backs up every workspace before migrating', async () => {
    await migrator.query(`
      INSERT INTO api.workspaces (id, slug, name) VALUES
        ('${WS_1}', 'up-1', 'Upgrade one'), ('${WS_2}', 'up-2', 'Upgrade two')`)
    const { store, objects } = storage()
    const outcome = await backupBeforeUpgrade(deps(store), withNewerMigration)
    expect(outcome).toEqual({ status: 'backed_up', workspaces: 2 })
    expect([...objects.keys()].filter((k) => k.includes(WS_1))).toHaveLength(1)
    expect([...objects.keys()].filter((k) => k.includes(WS_2))).toHaveLength(1)
    const { rows } = await migrator.query(
      `SELECT status FROM internal.workspace_backups
        WHERE workspace_id IN ('${WS_1}', '${WS_2}')`,
    )
    expect(rows.map((r) => r.status)).toEqual(['succeeded', 'succeeded'])
  })

  it('stops, naming the workspace, when a backup cannot be made', async () => {
    const { store } = storage(true)
    const outcome = await backupBeforeUpgrade(deps(store), withNewerMigration)
    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect([WS_1, WS_2]).toContain(outcome.workspaceId)
      expect(outcome.error).toContain('bucket unreachable')
    }
  })
})
