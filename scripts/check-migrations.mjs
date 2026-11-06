/**
 * Pull request check: migrations added on this branch must sort after the
 * newest one on the base branch (default `origin/main`). A branch started
 * before another migration merged would otherwise carry an older name, and a
 * database that has already moved past it would apply it late. The fix is
 * always the same: rename the file with `pnpm db:new` style timestamp (or
 * simply re-run it) after rebasing.
 *
 * Also rejects new numbered migrations and any change to the frozen journal.
 *
 * Usage: node scripts/check-migrations.mjs [base-ref]
 */
import { execFileSync } from 'node:child_process'

import { TIMESTAMP_NAME } from './lib/migrations.mjs'

const base = process.argv[2] ?? 'origin/main'
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)

const onBase = new Set(
  git('ls-tree', '--name-only', base, 'drizzle/').map((p) =>
    p.replace('drizzle/', ''),
  ),
)
const here = new Set(
  git('ls-files', 'drizzle/').map((p) => p.replace('drizzle/', '')),
)
const added = [...here].filter(
  (name) => name.endsWith('.sql') && !onBase.has(name),
)
const problems = []

if (
  git(
    'diff',
    '--name-only',
    `${base}...HEAD`,
    '--',
    'drizzle/meta/_journal.json',
  ).length
) {
  problems.push(
    'drizzle/meta/_journal.json is frozen (it lists migrations 0000 to 0108 only). New migrations are timestamp-named files with no journal entry.',
  )
}
const latestOnBase = [...onBase]
  .filter((name) => TIMESTAMP_NAME.test(name))
  .sort()
  .at(-1)
for (const name of added) {
  if (!TIMESTAMP_NAME.test(name)) {
    problems.push(
      `${name}: new migrations are named <YYYYMMDDHHMMSS>_<snake_case>.sql. Create one with: pnpm db:new <name>`,
    )
  } else if (latestOnBase && name <= latestOnBase) {
    problems.push(
      `${name}: sorts before ${latestOnBase}, which is already on ${base}. Rebase onto ${base} and rename the file with a newer timestamp (pnpm db:new makes one).`,
    )
  }
}

if (problems.length) {
  process.stderr.write(problems.map((p) => `✗ ${p}`).join('\n') + '\n')
  process.exit(1)
}
process.stdout.write(
  added.length
    ? `✓ ${added.length} new migration(s) sort after ${latestOnBase ?? 'the numbered history'}.\n`
    : '✓ No new migrations.\n',
)
