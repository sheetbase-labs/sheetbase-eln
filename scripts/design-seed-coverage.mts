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
 * Every identifier family counts, including families without an authority
 * yet. Missing capabilities are unmet exits, not coverage exclusions.
 * This checks identifiers only, not all visible scientific values or states.
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

/** Include snapshot labels (S-1) and single-letter sample condition keys. */
export const ID_PATTERN = /\b[A-Z]{1,6}(?:-\d{1,5})+\b/g

/** Fixed UI copy that is not backed by seeded data. */
export const ALLOWLIST = new Set<string>([
  // A digest name, not a data identifier.
  'SHA-256',
])

/**
 * Identifier families with a stored authority scanned below. Other families
 * are reported as authority gaps and still count as coverage misses.
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
  'SHT',
  'TPL',
  'CB',
  'MDL',
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
  /** Data identifiers considered, counting each screen occurrence. */
  total: number
  /** Data identifiers absent from the database. */
  unmatched: number
  /** Per-screen unmatched identifiers. */
  unmatchedByScreen: Array<{ screen: string; tokens: string[] }>
  /** ID prefixes without a scanned authority (also counted as misses). */
  displayFamilies: string[]
  /** Required families with zero seeded values. */
  missingFamilies: string[]
  /** Required values absent from the database. */
  missingValues: string[]
}

export function coverageExitCode(
  summary: CoverageSummary,
  reportOnly = false,
): 0 | 1 {
  return !reportOnly &&
    (summary.unmatched > 0 ||
      summary.missingFamilies.length > 0 ||
      summary.missingValues.length > 0)
    ? 1
    : 0
}

export function summarizeCoverage(
  screens: ReadonlyArray<ScreenText>,
  seeded: ReadonlyArray<string>,
  requiredFamilies: ReadonlyArray<string>,
  requiredValues: ReadonlyArray<string>,
): CoverageSummary {
  const seededValues = new Set(seeded)
  const seededMatch = (token: string) =>
    STORED_PREFIXES.has(prefixOf(token)) && seededValues.has(token)
  let total = 0
  let unmatched = 0
  const unmatchedByScreen: Array<{ screen: string; tokens: string[] }> = []
  const displayFamilies = new Set<string>()

  for (const screen of screens) {
    const tokens = Array.from(
      new Set(screen.text.match(ID_PATTERN) ?? []),
    ).filter((token) => !ALLOWLIST.has(token))
    for (const token of tokens) {
      if (!STORED_PREFIXES.has(prefixOf(token))) {
        displayFamilies.add(prefixOf(token))
      }
    }
    total += tokens.length
    const miss = tokens.filter((token) => !seededMatch(token))
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
      [
        'records',
        `select identifier from api.records where (
          (kind = 'experiment' and identifier like 'EXP-%') or
          (kind = 'sample' and identifier like 'SMP-%') or
          (kind = 'protocol_template' and identifier like 'PRT-%') or
          (kind = 'reagent' and identifier like 'MAT-%') or
          (identifier like 'CB-%' and exists (
            select 1 from api.record_models m
             where m.workspace_id = api.records.workspace_id
               and m.key = api.records.kind and m.identifier_prefix = 'CB')))`,
      ],
      [
        'datasets',
        "select display_id from api.datasets where display_id like 'DS-%'",
      ],
      [
        'pipelines',
        "select display_id from api.pipeline_definitions where display_id like 'PL-%'",
      ],
      [
        'sheet_instances',
        "select display_id from api.sheet_instances where display_id like 'SHT-%'",
      ],
      [
        'notebook_templates',
        "select display_id from api.notebook_templates where display_id like 'TPL-%'",
      ],
      [
        'bookings',
        "select display_id from api.calendar_bookings where display_id like 'CAL-%'",
      ],
      [
        'instruments',
        "select display_id from api.instruments where display_id like 'INS-%'",
      ],
      [
        'projects',
        "select display_id from api.projects where display_id like 'PRJ-%'",
      ],
      ['clients', "select code from api.clients where code like 'CL-%'"],
      [
        'dataset_schema_definitions',
        "select display_id from api.dataset_schema_definitions where display_id like 'MDL-%'",
      ],
    ]
    for (const [, sql] of queries) {
      const { rows } = await client.query<Record<string, unknown>>(
        `${sql} and workspace_id in
          (select id from api.workspaces where slug = any($1::text[]))`,
        [
          [
            'process-development',
            'analytical-development',
            'gmp-manufacturing',
            'quality-control',
          ],
        ],
      )
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
    `\nidentifier coverage only: ${summary.total - summary.unmatched}/${summary.total} matched, ${summary.unmatched} unmatched`,
  )
  console.log(
    `identifier families without a scanned authority: ${summary.displayFamilies.join(', ')}`,
  )

  const problems: string[] = []
  if (summary.unmatched > 0) {
    problems.push(`${summary.unmatched} unmatched screen identifiers`)
  }
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
  } else {
    console.log(
      `design-seed coverage gate passed: ${requiredFamilies.length} families, ${requiredValues.length} required values`,
    )
  }
  process.exitCode = coverageExitCode(summary, reportOnly)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
