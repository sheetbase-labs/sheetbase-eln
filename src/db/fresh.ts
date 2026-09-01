/**
 * Fresh-environment flow: reset the local database, apply the full migration
 * history and seed. Proves a fresh database can be migrated and seeded in one
 * documented command. See docs/development/seeds.md and docs/development/migrations.md.
 *
 * Usage: pnpm db:fresh [--demo]
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

config({ path: ['.env.local', '.env'] })

const hasMigrations = existsSync(
  new URL('../../drizzle/meta/_journal.json', import.meta.url),
)

execFileSync('pnpm', ['exec', 'tsx', 'src/db/reset.ts'], { stdio: 'inherit' })

if (hasMigrations) {
  execFileSync('pnpm', ['db:migrate'], { stdio: 'inherit' })
} else {
  console.log('No migrations yet; skipping pnpm db:migrate.')
}

const seedArgs = ['exec', 'tsx', 'src/db/seed/run.ts']
if (process.argv.includes('--demo')) {
  seedArgs.push('--demo')
}
execFileSync('pnpm', seedArgs, { stdio: 'inherit' })

console.log('Fresh environment ready.')
