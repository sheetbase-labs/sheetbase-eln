/** Read-only checks. An operator must schedule this and scrape its textfile. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { BACKUP_PREFIX_PATTERN } from '../src/lib/backup'
import { atomicWrite, verifyBackupSet } from './backup-io'

const directory = process.env.SHEETBASE_BACKUP_DIR ?? '/opt/sheetbase/backups'
const reportPath =
  process.env.SHEETBASE_DRILL_REPORT_PATH ??
  join(directory, 'restore-drill.json')
const now = Date.now()
function maxAge(name: string) {
  const value = Number(process.env[name])
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(
      `${name} must be an operator-selected positive number of seconds`,
    )
  return value
}
const backupAge = maxAge('SHEETBASE_BACKUP_MAX_AGE_SECONDS')
const drillAge = maxAge('SHEETBASE_DRILL_MAX_AGE_SECONDS')
const checkAge = maxAge('SHEETBASE_RECOVERY_CHECK_MAX_AGE_SECONDS')
function fresh(timestamp: string, age: number) {
  const elapsed = now - Date.parse(timestamp)
  return elapsed >= 0 && elapsed <= age * 1000
}
let backup = false
let drill = false
let readiness = false
try {
  const pointer = z
    .object({ prefix: z.string().regex(BACKUP_PREFIX_PATTERN) })
    .parse(JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8')))
  const set = await verifyBackupSet(
    join(directory, `${pointer.prefix}-manifest.json`),
  )
  backup = fresh(set.manifest.finishedAt, backupAge)
} catch {
  /* Missing, malformed, corrupt and stale sets are unhealthy. */
}
try {
  const report = z
    .object({ ok: z.boolean(), finishedAt: z.iso.datetime() })
    .parse(JSON.parse(await readFile(reportPath, 'utf8')))
  drill = report.ok && fresh(report.finishedAt, drillAge)
} catch {
  /* No run or a malformed report is not success. */
}
try {
  const url = new URL(process.env.SHEETBASE_READINESS_URL ?? '')
  if (url.pathname !== '/api/health/ready' || url.username || url.password)
    throw new Error('invalid readiness URL')
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  })
  const body = z
    .object({
      status: z.literal('ready'),
      database: z.object({
        migration: z.object({ status: z.literal('compatible') }),
      }),
    })
    .safeParse(await response.json())
  readiness = response.ok && body.success
} catch {
  /* Reachable metrics do not imply database/application readiness. */
}
const result = { backup, drill, readiness }
const metrics = process.env.SHEETBASE_METRICS_TEXTFILE_DIR
if (!metrics) throw new Error('SHEETBASE_METRICS_TEXTFILE_DIR is required')
await atomicWrite(
  join(metrics, 'sheetbase_recovery.prom'),
  Object.entries(result)
    .map(([name, ok]) => `sheetbase_recovery_${name}_healthy ${ok ? 1 : 0}\n`)
    .join('') +
    `sheetbase_recovery_check_time_seconds ${Math.floor(now / 1000)}\nsheetbase_recovery_check_max_age_seconds ${checkAge}\n`,
  0o644,
)
process.stdout.write(
  JSON.stringify({ message: 'recovery check', ...result }) + '\n',
)
if (!backup || !drill || !readiness) process.exitCode = 1
