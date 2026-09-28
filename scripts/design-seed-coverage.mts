/**
 * DSYS-05.4 — design-seed coverage.
 *
 * For each screen-text extract, find values that look like data (IDs such as
 * EXP-0138, DS-0298, SMP-2248) and report the ones that do not appear in the
 * seeded database or in the fixed UI copy allowlist. The unmatched count
 * reaches zero at the end of Roadmap 4; until then this is a report, not a
 * gate.
 *
 * Run: pnpm tsx scripts/design-seed-coverage.mts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { config } from 'dotenv'
import { Client } from 'pg'

config({ path: ['.env.local', '.env'] })

const SCREEN_TEXT_DIR = join(
  'docs',
  'knowledge',
  'design',
  'ui-system-v3',
  'screen-text',
)

/** ID-like tokens: two to six capitals, a dash, two to five digits. */
const ID_PATTERN = /\b[A-Z]{2,6}-\d{2,5}\b/g

/** Fixed UI copy that is not backed by seeded data. */
const ALLOWLIST = new Set<string>([
  // A digest name, not a data identifier.
  'SHA-256',
])

/**
 * Identifier families the data model stores and the seed can reproduce. Other
 * id-like values (DS-0311, PL-0007, SHT-0019, MDL-0012, CAL-0913 …) are
 * display identifiers with no stored column yet, so they are reported
 * separately as a data-model gap rather than counted as seed misses.
 */
const STORED_PREFIXES = new Set(['EXP', 'SMP', 'PRT', 'MAT'])

function prefixOf(token: string): string {
  return token.split('-')[0] ?? ''
}

async function seededStrings(): Promise<string[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const values: string[] = []
    const queries: Array<[string, string]> = [
      ['records', 'select identifier, title from api.records'],
      ['datasets', 'select name from api.datasets'],
      ['pipelines', 'select key, name from api.pipeline_definitions'],
      ['templates', 'select key, name from api.notebook_templates'],
    ]
    for (const [, sql] of queries) {
      const { rows } = await client.query<Record<string, unknown>>(sql)
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (typeof value === 'string') values.push(value)
        }
      }
    }
    return values
  } finally {
    await client.end()
  }
}

async function main() {
  const seeded = await seededStrings()
  const screens = readdirSync(SCREEN_TEXT_DIR).filter((name) =>
    name.endsWith('.txt'),
  )

  let total = 0
  let unmatchedTotal = 0
  const displayFamilies = new Set<string>()
  for (const screen of screens) {
    const text = readFileSync(join(SCREEN_TEXT_DIR, screen), 'utf8')
    const tokens = Array.from(new Set(text.match(ID_PATTERN) ?? []))
    const stored = tokens.filter((token) =>
      STORED_PREFIXES.has(prefixOf(token)),
    )
    for (const token of tokens) {
      if (!STORED_PREFIXES.has(prefixOf(token))) {
        displayFamilies.add(prefixOf(token))
      }
    }
    if (stored.length === 0) continue
    total += stored.length
    const unmatched = stored.filter(
      (token) =>
        !ALLOWLIST.has(token) && !seeded.some((value) => value.includes(token)),
    )
    unmatchedTotal += unmatched.length
    if (unmatched.length > 0) {
      console.log(`${screen.replace('.txt', '')}: ${unmatched.join(', ')}`)
    }
  }

  console.log(
    `\nseedable id coverage: ${total - unmatchedTotal}/${total} matched, ${unmatchedTotal} unmatched`,
  )
  console.log(
    `display-id families with no stored column yet: ${[...displayFamilies].sort().join(', ')}`,
  )
}

await main()
