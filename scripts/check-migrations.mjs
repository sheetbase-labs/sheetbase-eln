/**
 * Pull request check on migrations added by this branch (against the base,
 * default `origin/main`).
 *
 * A migration that sorts before one already on the base is applied late by a
 * database that has moved past it. That is harmless when the two touch
 * different tables, functions or policies, so it only fails when a newer
 * migration on the base touches the same object. Otherwise it passes with a
 * notice and the PR needs no rebase. The fix for a real overlap is to rebase
 * and rename the file with a fresh timestamp (`pnpm db:new` makes one).
 *
 * Also rejects new numbered migrations and any change to the frozen journal.
 *
 * Usage: node scripts/check-migrations.mjs [base-ref]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { migrationObjects, sharedObjects } from './lib/migration-objects.mjs'
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
const notices = []

const read = (ref, name) =>
  execFileSync('git', ['show', `${ref}:drizzle/${name}`], { encoding: 'utf8' })

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
    const mine = migrationObjects(readFileSync(`drizzle/${name}`, 'utf8'))

    const clashes = [...onBase]
      .flatMap((other) =>
        TIMESTAMP_NAME.test(other) && other > name
          ? [
              {
                other,
                shared: sharedObjects(
                  mine,
                  migrationObjects(read(base, other)),
                ),
              },
            ]
          : [],
      )
      .filter((clash) => clash.shared.length)

    if (clashes.length) {
      const first = clashes[0]
      problems.push(
        `${name}: sorts before ${first.other} on ${base} and both touch ${first.shared.join(', ')}, so order matters. Rebase onto ${base} and rename the file with a newer timestamp (pnpm db:new makes one).`,
      )
    } else {
      notices.push(
        `${name} sorts before ${latestOnBase} on ${base}, but no newer migration touches the same objects, so it can merge as it is.`,
      )
    }
  }
}

for (const notice of notices) process.stdout.write(`ℹ ${notice}\n`)

if (problems.length) {
  process.stderr.write(problems.map((p) => `✗ ${p}`).join('\n') + '\n')
  process.exit(1)
}

process.stdout.write(
  added.length
    ? `✓ ${added.length} new migration(s) are safe to merge in any order.\n`
    : '✓ No new migrations.\n',
)
