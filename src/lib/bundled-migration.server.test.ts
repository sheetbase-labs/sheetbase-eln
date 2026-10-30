import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { bundledMigrationVersion } from './bundled-migration.server'

function build(journal: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'bundled-migration-'))
  if (journal !== null) {
    mkdirSync(join(root, 'drizzle/meta'), { recursive: true })
    writeFileSync(join(root, 'drizzle/meta/_journal.json'), journal)
  }
  return root
}

describe('bundledMigrationVersion', () => {
  it('is the newest migration in the journal that ships with the build', () => {
    const root = build(
      JSON.stringify({
        entries: [
          { when: 1800000000001, tag: '0001_a' },
          { when: 1800000000002, tag: '0002_b' },
        ],
      }),
    )
    expect(bundledMigrationVersion(root)).toBe('1800000000002')
  })

  it('is null when the build carries no journal, so Diagnostics says "not checked"', () => {
    expect(bundledMigrationVersion(build(null))).toBeNull()
    expect(bundledMigrationVersion(build('not json'))).toBeNull()
    expect(bundledMigrationVersion(build('{"entries":[]}'))).toBeNull()
  })

  it('reads this repository’s own journal', () => {
    expect(bundledMigrationVersion()).toMatch(/^\d{13}$/)
  })
})
