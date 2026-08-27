/**
 * PLAT-01 — backup set naming, manifests and retention.
 *
 * A backup *set* is every file produced by one backup run and sharing a
 * timestamp prefix (`sheetbase-<UTC timestamp>`): the database dump, the
 * object-storage archive and the manifest. Retention prunes whole sets, so a
 * database dump is never kept without its matching storage archive.
 */

export const BACKUP_PREFIX_PATTERN = /^sheetbase-\d{8}T\d{6}Z$/

/** `sheetbase-20260827T234901Z` style UTC prefix for one backup run. */
export function backupPrefix(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `sheetbase-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  )
}

/** Parses a timestamp prefix back to a Date; null when not a backup prefix. */
export function parseBackupPrefix(
  name: string,
): { prefix: string; createdAt: Date } | null {
  const match = name.match(/^(sheetbase-\d{8}T\d{6}Z)/)
  if (!match) return null
  const prefix = match[1]
  const m = prefix.match(
    /^sheetbase-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  )
  if (!m) return null
  const createdAt = new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
  )
  return { prefix, createdAt }
}

/**
 * Selects backup sets strictly older than the retention window, never
 * including the newest set. An invalid or unparseable file name is never
 * selected for deletion.
 */
export function selectExpiredBackupPrefixes(
  files: string[],
  now: Date,
  retentionDays: number,
): string[] {
  if (retentionDays < 0) throw new Error('retention days must not be negative')
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  const byPrefix = new Map<string, Date>()
  for (const file of files) {
    const parsed = parseBackupPrefix(file)
    if (!parsed) continue
    const known = byPrefix.get(parsed.prefix)
    if (!known || parsed.createdAt < known) {
      byPrefix.set(parsed.prefix, parsed.createdAt)
    }
  }
  let newest = 0
  for (const createdAt of byPrefix.values()) {
    newest = Math.max(newest, createdAt.getTime())
  }
  const expired: string[] = []
  for (const [prefix, createdAt] of byPrefix) {
    const t = createdAt.getTime()
    if (t <= cutoff && t < newest) expired.push(prefix)
  }
  return expired.sort()
}

export interface BackupManifest {
  prefix: string
  startedAt: string
  finishedAt: string
  durationMs: number
  database: {
    container: string
    database: string
    dumpBytes: number
    dumpSha256: string
  }
  objects: { archiveBytes: number; archiveSha256: string } | null
  retentionDays: number
}

/** True when a manifest proves the restore prerequisites for its components. */
export function manifestIsComplete(manifest: BackupManifest): boolean {
  if (!BACKUP_PREFIX_PATTERN.test(manifest.prefix)) return false
  return manifest.database.dumpBytes > 0 && manifest.database.dumpSha256 !== ''
}
