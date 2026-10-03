/**
 * DSYS-05.4 — design-seed coverage gate.
 *
 * For each screen-text extract, find values that look like data (IDs such as
 * EXP-0138, DS-0298, SMP-2248) and report the ones that do not appear in the
 * seeded database or in the fixed UI copy allowlist. The unmatched count
 * reaches zero at the end of Roadmap 4.
 *
 * Unlike the original report-only version this is a gate: it exits non-zero
 * when a required id family is absent from the database, or when a required
 * design value cannot be found. Add `--require=PFX[,PFX]` to declare extra
 * required families and `--expect=ID[,ID]` to declare extra required values
 * (used by the deliberate-miss test). Pass `--report-only` to restore the old
 * always-zero behaviour.
 *
 * Display identifiers with no stored column yet are reported separately; see
 * docs/knowledge/roadmap-4/DISPLAY_IDS.md.
 *
 * Run: pnpm design:coverage
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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
export const ID_PATTERN = /\b[A-Z]{2,6}-\d{2,5}\b/g

/** Fixed UI copy that is not backed by seeded data. */
export const ALLOWLIST = new Set<string>([
  // A digest name, not a data identifier.
  'SHA-256',
])

/**
 * Identifier families the data model stores and the seed can reproduce. Other
 * id-like values (DS-0311, PL-0007, SHT-0019, MDL-0012, CAL-0913 …) are
 * display identifiers with no stored column yet, so they are reported
 * separately as a data-model gap rather than counted as seed misses.
 */
export const STORED_PREFIXES = new Set([
  'EXP',
  'SMP',
  'PRT',
  'MAT',
  'DS',
  'PL',
  'CAL',
  'INS',
  'PRJ',
  'CL',
])

/**
 * Families that MUST have at least one seeded value. A family here is a data
 * contract: if the design seed stops producing it, the check fails.
 */
export const REQUIRED_FAMILIES: ReadonlyArray<string> = [
  ...STORED_PREFIXES,
].sort()

/**
 * Specific design values that MUST appear in the database. These are the
 * anchors the parity suite routes read (the working sheet, the review
 * experiment, the datasets the sheet and screens cite).
 */
export const REQUIRED_VALUES: ReadonlyArray<string> = [
  'EXP-0138',
  'DS-0298',
  'DS-0311',
  'DS-0320',
  'SHT-0019',
  'SHT-0020',
]

export function prefixOf(token: string): string {
  return token.split('-')[0] ?? ''
}

export interface ScreenText {
  name: string
  text: string
}

export interface CoverageSummary {
  /** Stored-family tokens considered, counting each screen occurrence. */
  total: number
  /** Stored-family tokens absent from the database and the allowlist. */
  unmatched: number
  /** Per-screen unmatched stored tokens. */
  unmatchedByScreen: Array<{ screen: string; tokens: string[] }>
  /** ID prefixes with no stored column yet (reported, never a miss). */
  displayFamilies: string[]
  /** Required families with zero seeded values. */
  missingFamilies: string[]
  /** Required values absent from the database. */
  missingValues: string[]
}

export function summarizeCoverage(
  screens: ReadonlyArray<ScreenText>,
  seeded: ReadonlyArray<string>,
  requiredFamilies: ReadonlyArray<string>,
  requiredValues: ReadonlyArray<string>,
): CoverageSummary {
  const seededMatch = (token: string) => seeded.some((v) => v.includes(token))
  let total = 0
  let unmatched = 0
  const unmatchedByScreen: Array<{ screen: string; tokens: string[] }> = []
  const displayFamilies = new Set<string>()

  for (const screen of screens) {
    const tokens = Array.from(new Set(screen.text.match(ID_PATTERN) ?? []))
    for (const token of tokens) {
      if (!STORED_PREFIXES.has(prefixOf(token))) {
        displayFamilies.add(prefixOf(token))
      }
    }
    const stored = tokens.filter((token) =>
      STORED_PREFIXES.has(prefixOf(token)),
    )
    if (stored.length === 0) continue
    total += stored.length
    const miss = stored.filter(
      (token) => !ALLOWLIST.has(token) && !seededMatch(token),
    )
    unmatched += miss.length
    if (miss.length > 0) {
      unmatchedByScreen.push({
        screen: screen.name.replace('.txt', ''),
        tokens: miss,
      })
    }
  }

  const missingFamilies = requiredFamilies.filter(
    (prefix) => !seeded.some((value) => value.startsWith(`${prefix}-`)),
  )
  const missingValues = requiredValues.filter((value) => !seededMatch(value))

  return {
    total,
    unmatched,
    unmatchedByScreen,
    displayFamilies: [...displayFamilies].sort(),
    missingFamilies,
    missingValues,
  }
}

export function parseListArg(
  argv: ReadonlyArray<string>,
  name: string,
): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    const inline = `--${name}=`
    if (arg.startsWith(inline)) {
      out.push(
        ...arg
          .slice(inline.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    } else if (arg === `--${name}`) {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        out.push(
          ...next
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
        i += 1
      }
    }
  }
  return out
}

export async function seededStrings(): Promise<string[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const values: string[] = []
    const queries: Array<[string, string]> = [
      ['records', 'select identifier, title from api.records'],
      ['datasets', 'select name, display_id from api.datasets'],
      [
        'pipelines',
        'select key, name, display_id from api.pipeline_definitions',
      ],
      ['sheet_instances', 'select name, display_id from api.sheet_instances'],
      [
        'notebook_templates',
        'select key, name, display_id from api.notebook_templates',
      ],
      ['bookings', 'select title, display_id from api.calendar_bookings'],
      ['instruments', 'select name, display_id from api.instruments'],
      ['projects', 'select title, display_id from api.projects'],
      ['clients', 'select name, code from api.clients'],
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
  const argv = process.argv.slice(2)
  const reportOnly = argv.includes('--report-only')
  const extraFamilies = parseListArg(argv, 'require')
  const extraValues = parseListArg(argv, 'expect')
  const requiredFamilies = [
    ...new Set([...REQUIRED_FAMILIES, ...extraFamilies]),
  ].sort()
  const requiredValues = [...new Set([...REQUIRED_VALUES, ...extraValues])]

  const seeded = await seededStrings()
  const screens = readdirSync(SCREEN_TEXT_DIR)
    .filter((name) => name.endsWith('.txt'))
    .map((name) => ({
      name,
      text: readFileSync(join(SCREEN_TEXT_DIR, name), 'utf8'),
    }))

  const summary = summarizeCoverage(
    screens,
    seeded,
    requiredFamilies,
    requiredValues,
  )

  for (const entry of summary.unmatchedByScreen) {
    console.log(`${entry.screen}: ${entry.tokens.join(', ')}`)
  }

  console.log(
    `\nseedable id coverage: ${summary.total - summary.unmatched}/${summary.total} matched, ${summary.unmatched} unmatched`,
  )
  console.log(
    `display-id families with no stored column yet: ${summary.displayFamilies.join(', ')}`,
  )

  const problems: string[] = []
  if (summary.missingFamilies.length > 0) {
    problems.push(
      `missing required families: ${summary.missingFamilies.join(', ')}`,
    )
  }
  if (summary.missingValues.length > 0) {
    problems.push(
      `missing required values: ${summary.missingValues.join(', ')}`,
    )
  }

  if (problems.length > 0) {
    console.error(`\ndesign-seed coverage gate failed: ${problems.join('; ')}`)
    if (!reportOnly) process.exitCode = 1
  } else {
    console.log(
      `design-seed coverage gate passed: ${requiredFamilies.length} families, ${requiredValues.length} required values`,
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
