import { describe, expect, it } from 'vitest'

import type { BackupManifest } from './backup'
import {
  backupPrefix,
  manifestIsComplete,
  parseBackupPrefix,
  selectExpiredBackupPrefixes,
} from './backup'

describe('backupPrefix', () => {
  it('formats a UTC timestamp prefix', () => {
    const now = new Date('2026-08-27T23:49:01Z')
    expect(backupPrefix(now)).toBe('sheetbase-20260827T234901Z')
  })

  it('round-trips through parseBackupPrefix', () => {
    const now = new Date('2026-01-03T07:05:09Z')
    const parsed = parseBackupPrefix(backupPrefix(now))
    expect(parsed?.createdAt.toISOString()).toBe(now.toISOString())
  })

  it('rejects non-backup names', () => {
    expect(parseBackupPrefix('latest.json')).toBeNull()
    expect(parseBackupPrefix('pre-deploy-2026.sql.gz')).toBeNull()
  })
})

describe('selectExpiredBackupPrefixes', () => {
  const now = new Date('2026-08-27T12:00:00Z')
  it('prunes sets past the retention window', () => {
    const files = [
      'sheetbase-20260810T000000Z-db.sql.gz', // 17 days old
      'sheetbase-20260810T000000Z-objects.tar.gz',
      'sheetbase-20260820T000000Z-db.sql.gz', // 7 days old
      'sheetbase-20260826T000000Z-db.sql.gz', // 1 day old
    ]
    expect(selectExpiredBackupPrefixes(files, now, 14)).toEqual([
      'sheetbase-20260810T000000Z',
    ])
  })

  it('never prunes the newest set even when it is past the window', () => {
    const files = ['sheetbase-20260810T000000Z-db.sql.gz']
    expect(selectExpiredBackupPrefixes(files, now, 14)).toEqual([])
  })

  it('ignores files without a backup prefix', () => {
    const files = ['latest.json', 'notes.txt', 'sheetbase-bad']
    expect(selectExpiredBackupPrefixes(files, now, 0)).toEqual([])
  })
})

describe('manifestIsComplete', () => {
  const base: BackupManifest = {
    prefix: 'sheetbase-20260827T120000Z',
    startedAt: '2026-08-27T12:00:00Z',
    finishedAt: '2026-08-27T12:01:00Z',
    durationMs: 60_000,
    database: {
      container: 'c',
      database: 'sheetbase',
      dumpBytes: 1024,
      dumpSha256: 'abc',
    },
    objects: null,
    retentionDays: 14,
  }

  it('accepts a complete manifest', () => {
    expect(manifestIsComplete(base)).toBe(true)
  })

  it('rejects an empty dump', () => {
    expect(
      manifestIsComplete({
        ...base,
        database: { ...base.database, dumpBytes: 0 },
      }),
    ).toBe(false)
  })

  it('rejects a malformed prefix', () => {
    expect(manifestIsComplete({ ...base, prefix: 'latest' })).toBe(false)
  })
})
