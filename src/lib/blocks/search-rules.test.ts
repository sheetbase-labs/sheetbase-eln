/**
 * Every block type must say what text it contributes to search. A new type
 * added to BLOCK_TYPES without a branch in `internal.block_search_text` would
 * silently fall back to the generic extractor, so this fails until the rule is
 * written.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BLOCK_TYPES } from './registry'

const DRIZZLE = join(__dirname, '../../../drizzle')

/** The body of `internal.block_search_text` in the latest migration defining it. */
function latestBlockSearchText(): string {
  const files = readdirSync(DRIZZLE)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .reverse()
  for (const name of files) {
    const sql = readFileSync(join(DRIZZLE, name), 'utf8')
    const start = sql.indexOf('FUNCTION internal.block_search_text(')
    if (start === -1) continue
    const end = sql.indexOf('--> statement-breakpoint', start)
    return sql.slice(start, end === -1 ? undefined : end)
  }
  throw new Error('internal.block_search_text is not defined in any migration')
}

describe('block search text rules', () => {
  const body = latestBlockSearchText()

  it.each(BLOCK_TYPES)('has a rule for %s', (type) => {
    expect(body).toContain(`WHEN '${type}' THEN`)
  })

  it('has no rule for a type that does not exist', () => {
    const ruled = [...body.matchAll(/WHEN '([a-z_]+)' THEN/g)].map((m) => m[1])
    expect(
      ruled.filter((t) => !(BLOCK_TYPES as readonly string[]).includes(t)),
    ).toEqual([])
  })
})
