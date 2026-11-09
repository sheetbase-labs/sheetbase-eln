/**
 * Create an empty migration named for the moment it is made:
 * `drizzle/<YYYYMMDDHHMMSS>_<name>.sql` (UTC). Because the name carries a
 * timestamp rather than the next number, two branches that each add one never
 * collide and never need renumbering.
 *
 * Usage: pnpm db:new <snake_case_name>
 */
import { readdirSync, writeFileSync } from 'node:fs'

import { TIMESTAMP_NAME, timestampMs } from './lib/migrations.mjs'

const name = process.argv[2]

if (!name || !/^[a-z0-9][a-z0-9_]*$/.test(name)) {
  process.stderr.write('Usage: pnpm db:new <snake_case_name>\n')
  process.exit(1)
}

const folder = 'drizzle'

const latest = readdirSync(folder)
  .filter((file) => TIMESTAMP_NAME.test(file))
  .map((file) => file.slice(0, 14))
  .sort()
  .at(-1)

// Never go backwards on a machine whose clock is behind the newest migration.
const now = Math.max(Date.now(), latest ? timestampMs(latest) + 1000 : 0)

const stamp = new Date(now)
  .toISOString()
  .replace(/\.\d+Z$/, '')
  .replace(/[-:T]/g, '')

const file = `${folder}/${stamp}_${name}.sql`

writeFileSync(
  file,
  '-- Write the migration here. Separate statements with a line that reads\n' +
    '-- "--> statement-breakpoint" when one fails without it.\n',
  { flag: 'wx' },
)

process.stdout.write(`${file}\n`)
