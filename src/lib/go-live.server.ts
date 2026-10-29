/**
 * What an admin needs to know before real people rely on this site: how
 * people sign in, whether email can be sent, and whether anything backs the
 * data up. Read from configuration and the backup folder only, so a check can
 * be run at any time without side effects.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

import { readAuthMethods } from '#/lib/auth-methods'

export interface GoLiveStatus {
  signIn: {
    /** Anyone who opens the site is signed in as a demo user. */
    open: boolean
    methods: string[]
  }
  email: { configured: boolean }
  backup: {
    /** Where the backup status comes from. */
    source: 'folder' | 'host' | 'none'
    lastBackupAt: string | null
    /** The folder is set but its latest backup could not be read. */
    unreadable: boolean
  }
}

const latestBackup = z.object({ finishedAt: z.iso.datetime() })

export async function readBackupStatus(
  env: Record<string, string | undefined> = process.env,
): Promise<GoLiveStatus['backup']> {
  const dir = env.SHEETBASE_BACKUP_DIR
  if (dir) {
    try {
      const raw = await readFile(join(dir, 'latest.json'), 'utf8')
      const parsed = latestBackup.parse(JSON.parse(raw))
      return {
        source: 'folder',
        lastBackupAt: parsed.finishedAt,
        unreadable: false,
      }
    } catch {
      return { source: 'folder', lastBackupAt: null, unreadable: true }
    }
  }
  if (env.SHEETBASE_BACKUPS_BY_HOST === 'true') {
    return { source: 'host', lastBackupAt: null, unreadable: false }
  }
  return { source: 'none', lastBackupAt: null, unreadable: false }
}

export async function readGoLive(
  env: Record<string, string | undefined> = process.env,
): Promise<GoLiveStatus> {
  const methods = readAuthMethods(env)
  const names = [
    ...(methods.github ? ['GitHub'] : []),
    ...(methods.oidc ? [methods.oidc.name] : []),
    ...(methods.emailLink ? ['Email link'] : []),
  ]
  return {
    signIn: { open: env.SHEETBASE_DEV_AUTH_FREE === 'true', methods: names },
    email: { configured: Boolean(env.SMTP_HOST) },
    backup: await readBackupStatus(env),
  }
}
