/**
 * Pre-commit check on staged migrations: new files in `drizzle/` are
 * timestamp-named (`pnpm db:new <name>`) and the journal is frozen. The full
 * ordering check against main runs on pre-push and in CI
 * (`scripts/check-migrations.mjs`).
 *
 * Usage: node scripts/check-staged-migrations.mjs <staged drizzle paths...>
 */
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

import { TIMESTAMP_NAME } from './lib/migrations.mjs'

const added = new Set(
  execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=A', '--', 'drizzle/'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean),
)

const problems = []

for (const path of process.argv.slice(2)) {
  if (path === 'drizzle/meta/_journal.json')
    problems.push(`${path} is frozen; new migrations have no journal entry.`)
  else if (
    added.has(path) &&
    path.endsWith('.sql') &&
    !TIMESTAMP_NAME.test(basename(path))
  )
    problems.push(
      `${path} is not <YYYYMMDDHHMMSS>_<name>.sql; create it with pnpm db:new <name>.`,
    )
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
