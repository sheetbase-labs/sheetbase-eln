/**
 * A read batch only ever carries reads (src/lib/batchable-reads.ts). The
 * functions on its list must be STABLE in the database: PostgREST runs a stable
 * function in a read-only transaction, so batching one can never reorder or
 * merge a change. Adding a function that writes to the list fails here.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { BATCHABLE_READ_RPCS } from '../../src/lib/batchable-reads'
import { prepareTestDatabase } from './helpers'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
}, 120_000)

afterAll(async () => {
  await migrator.end()
})

describe('batchable read functions', () => {
  it('lists only functions that exist in the api schema', async () => {
    const { rows } = await migrator.query<{ proname: string }>(
      `SELECT DISTINCT proname FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'api' AND proname = ANY($1)`,
      [[...BATCHABLE_READ_RPCS]],
    )

    expect(rows.map((row) => row.proname).sort()).toEqual(
      [...BATCHABLE_READ_RPCS].sort(),
    )
  })

  it('lists only STABLE functions, which cannot write', async () => {
    const { rows } = await migrator.query<{
      proname: string
      provolatile: string
    }>(
      `SELECT proname, provolatile FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'api' AND proname = ANY($1)`,
      [[...BATCHABLE_READ_RPCS]],
    )

    expect(rows.filter((row) => row.provolatile !== 's')).toEqual([])
  })
})
