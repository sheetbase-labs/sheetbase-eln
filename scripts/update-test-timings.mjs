/**
 * Write measured per-file test times for the timed sequencer
 * (tests/timed-sequencer.ts).
 *
 * Usage: node scripts/update-test-timings.mjs <out.json> <report.json>...
 *
 * Each report is a Vitest JSON report, as the CI test jobs upload
 * (`*-timings-*` artifacts: `gh run download <run> -p 'db-timings-*'`). Times
 * are rounded up to whole seconds and the keys sorted, so a refresh changes
 * few lines.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'

const [out, ...reports] = process.argv.slice(2)

if (!out || reports.length === 0) {
  process.stderr.write(
    'usage: update-test-timings.mjs <out.json> <report.json>...\n',
  )
  process.exit(1)
}

const timings = {}

for (const report of reports) {
  const { testResults } = JSON.parse(readFileSync(report, 'utf8'))

  for (const file of testResults) {
    // Reports carry absolute paths from wherever they ran (a CI runner);
    // keep the part from the first top-level src/ or tests/ folder.
    const match = /\/((?:src|tests)\/.*)$/.exec(file.name)
    const name = match ? match[1] : relative(process.cwd(), file.name)

    timings[name] = Math.max(
      1,
      Math.ceil((file.endTime - file.startTime) / 1000),
    )
  }
}

const sorted = Object.fromEntries(
  Object.entries(timings).sort(([a], [b]) => (a < b ? -1 : 1)),
)

writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`)

console.log(`${Object.keys(sorted).length} file times written to ${out}`)
