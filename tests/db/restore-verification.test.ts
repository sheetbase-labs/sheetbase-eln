/**
 * PLAT-01 — restore verification evidence. `verifyRestoredDatabase` must
 * accept a fully-migrated, healthy database and reject a restored backup
 * that is missing core schema, RLS guards or the RPC surface — i.e. it must
 * detect an unusable backup rather than merely checking that a file exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  verifyObjectArchive,
  verifyRestoredDatabaseWithClient,
} from '#/lib/restore-verification'

import { prepareTestDatabase } from './helpers'

describe('restore verification', () => {
  let context: Awaited<ReturnType<typeof prepareTestDatabase>>

  beforeAll(async () => {
    context = await prepareTestDatabase()
  })

  afterAll(async () => {
    await context.migrator.end()
  })

  it('accepts a fully migrated database as usable Sheetbase state', async () => {
    const report = await verifyRestoredDatabaseWithClient(context.migrator)
    expect(report.checks.filter((c) => !c.ok)).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.counts.workspaces).toBe(0)
  })

  it('rejects a restored database that lost a core table', async () => {
    // The drill database is disposable; no transaction needed. Restore the
    // name in finally so this suite always leaves the schema intact.
    await context.migrator.query(
      'ALTER TABLE api.connector_runs RENAME TO connector_runs_drill_hidden',
    )
    let report: Awaited<ReturnType<typeof verifyRestoredDatabaseWithClient>>
    try {
      report = await verifyRestoredDatabaseWithClient(context.migrator)
    } finally {
      await context.migrator.query(
        'ALTER TABLE api.connector_runs_drill_hidden RENAME TO connector_runs',
      )
    }

    const after = await verifyRestoredDatabaseWithClient(context.migrator)
    expect(after.ok).toBe(true)
    expect(report.ok).toBe(false)
    expect(
      report.checks.find((c) => c.name === 'table_connector_runs')?.ok,
    ).toBe(false)
  })

  it('rejects a restored database without the migration journal', async () => {
    await context.migrator.query(
      'ALTER SCHEMA drizzle RENAME TO drizzle_drill_hidden',
    )
    let report: Awaited<ReturnType<typeof verifyRestoredDatabaseWithClient>>
    try {
      report = await verifyRestoredDatabaseWithClient(context.migrator)
    } finally {
      await context.migrator.query(
        'ALTER SCHEMA drizzle_drill_hidden RENAME TO drizzle',
      )
    }

    expect(report.ok).toBe(false)
    expect(report.checks.find((c) => c.name === 'migrations_applied')?.ok).toBe(
      false,
    )
  })
})

describe('verifyObjectArchive', () => {
  const rows = [
    { storage_key: 'a/b/obj1', byte_size: '100', status: 'active' },
    { storage_key: 'a/b/obj2', byte_size: '50', status: 'deleted' },
  ]

  it('accepts when every active object is present with a matching size', () => {
    const report = verifyObjectArchive(
      [
        { name: 'a/b/obj1', size: 100 },
        { name: 'a/b/extra', size: 10 },
      ],
      rows,
    )
    expect(report.ok).toBe(true)
  })

  it('rejects missing object bytes', () => {
    const report = verifyObjectArchive([], rows)
    expect(report.ok).toBe(false)
    expect(
      report.checks.find((c) => c.name === 'object_bytes_present')?.ok,
    ).toBe(false)
  })

  it('rejects size mismatches', () => {
    const report = verifyObjectArchive([{ name: 'a/b/obj1', size: 99 }], rows)
    expect(report.ok).toBe(false)
    expect(report.checks.find((c) => c.name === 'object_sizes_match')?.ok).toBe(
      false,
    )
  })

  it('rejects metadata rows with an empty archive', () => {
    const report = verifyObjectArchive([], rows)
    expect(
      report.checks.find((c) => c.name === 'object_metadata_present')?.ok,
    ).toBe(false)
  })

  it('accepts an empty archive when no metadata rows exist', () => {
    const report = verifyObjectArchive([], [])
    expect(report.ok).toBe(true)
  })
})
