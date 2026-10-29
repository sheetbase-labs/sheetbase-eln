/**
 * REV-05.2 — nightly audit verification (DEC-04: 06:00).
 *
 * Verifies the audit hash chain and every signed revision's integrity digest for
 * each workspace, records the result as a System entry, and exits non-zero if any
 * workspace fails so the schedule surfaces a broken trail.
 *
 * Run as the database owner (MIGRATION_DATABASE_URL), the same role the deploy
 * controller uses for migrations:
 *
 *   pnpm audit:verify
 *
 * Suggested cron entry on the VPS:
 *
 *   0 6 * * *  cd /opt/sheetbase && pnpm audit:verify >> /var/log/sheetbase-audit.log 2>&1
 */
import { Client } from 'pg'

import { verifyWorkspaces } from '../src/lib/audit-verification'

const connectionString =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL

if (!connectionString) {
  console.error(
    'audit:verify needs MIGRATION_DATABASE_URL (or DATABASE_URL) to be set',
  )
  process.exit(2)
}

const client = new Client({ connectionString })

async function main() {
  await client.connect()
  const checked = await verifyWorkspaces(client, 0)

  let failures = 0
  for (const { slug, result } of checked) {
    const summary = [
      `workspace=${slug}`,
      `ok=${result.ok}`,
      `chainEntries=${result.chain.entriesChecked}`,
      `signedRevisions=${result.signedRevisions.checked}`,
    ]
    if (!result.ok) {
      failures += 1
      summary.push(
        `firstBadSequence=${result.chain.firstBadSequence ?? '-'}`,
        `firstBadRevision=${result.signedRevisions.firstBadRevisionId ?? '-'}`,
      )
    }
    console.log(summary.join(' '))
  }

  if (failures > 0) {
    console.error(
      `audit:verify FAILED for ${failures} workspace(s); see the System entries in the audit log`,
    )
    process.exitCode = 1
  }
}

main()
  .catch((error: unknown) => {
    console.error('audit:verify failed:', error)
    process.exitCode = 1
  })
  .finally(() => client.end())
