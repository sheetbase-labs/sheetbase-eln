/**
 * What an administrator set for a plugin's connection: the values a connector,
 * a publisher or a notification channel asked for in `settings` (an API address,
 * a token). Server-only.
 *
 * Secrets are sealed with the same key as other third-party credentials
 * (`connector-secrets.server.ts`) and are never returned to anyone: the page
 * learns only that one is set. A plugin receives the values for the call that
 * needs them and nothing else.
 */
import { z } from 'zod'

import { openSecret, sealSecret, secretKey } from '../connector-secrets.server'
import type {
  ExtensionConnectorDeclaration,
  ExtensionNotificationChannelDeclaration,
} from './data-points'

export const SETTINGS_POINTS = [
  'connectors',
  'publishers',
  'notification-channels',
] as const

export type SettingsPoint = (typeof SETTINGS_POINTS)[number]

export const settingsScope = (point: SettingsPoint, itemId: string) =>
  `${point}:${itemId}`

export interface StoredSetting {
  scope: string
  name: string
  value: string
  secret: boolean
}

export interface SettingsStore {
  list: (
    workspaceId: string,
    extensionId: string,
    scope?: string,
  ) => Promise<StoredSetting[]>
  /** Sets the given values; a `null` removes the setting. */
  save: (
    workspaceId: string,
    extensionId: string,
    scope: string,
    values: Array<{ name: string; value: string | null; secret: boolean }>,
    actorUserId: string,
  ) => Promise<void>
}

export function databaseSettingsStore(): SettingsStore {
  return {
    async list(workspaceId, extensionId, scope) {
      const [{ db }, { sql }] = await Promise.all([
        import('#/db/client.server'),
        import('drizzle-orm'),
      ])

      const result = await db.execute(
        sql`SELECT scope, name, value, secret
              FROM internal.extension_settings
             WHERE workspace_id = ${workspaceId}::uuid
               AND extension_id = ${extensionId}::uuid
               AND (${scope ?? null}::text IS NULL OR scope = ${scope ?? null}::text)`,
      )

      return z
        .array(
          z.object({
            scope: z.string(),
            name: z.string(),
            value: z.string(),
            secret: z.boolean(),
          }),
        )
        .parse(result.rows)
    },
    async save(workspaceId, extensionId, scope, values, actorUserId) {
      const [{ db }, { sql }] = await Promise.all([
        import('#/db/client.server'),
        import('drizzle-orm'),
      ])

      for (const entry of values) {
        if (entry.value === null) {
          await db.execute(
            sql`DELETE FROM internal.extension_settings
                 WHERE workspace_id = ${workspaceId}::uuid
                   AND extension_id = ${extensionId}::uuid
                   AND scope = ${scope} AND name = ${entry.name}`,
          )
          continue
        }

        const stored = entry.secret
          ? sealSecret(entry.value, secretKey())
          : entry.value

        await db.execute(
          sql`INSERT INTO internal.extension_settings
                (extension_id, workspace_id, scope, name, value, secret, updated_by)
              VALUES (${extensionId}::uuid, ${workspaceId}::uuid, ${scope},
                      ${entry.name}, ${stored}, ${entry.secret}, ${actorUserId})
              ON CONFLICT (extension_id, scope, name)
              DO UPDATE SET value = EXCLUDED.value, secret = EXCLUDED.secret,
                            updated_at = now(), updated_by = EXCLUDED.updated_by`,
        )
      }
    },
  }
}

/** The values for one declaration, secrets opened, for the call that needs them. */
export async function openSettings(
  store: Pick<SettingsStore, 'list'>,
  workspaceId: string,
  extensionId: string,
  scope: string,
): Promise<Record<string, string>> {
  const rows = await store.list(workspaceId, extensionId, scope)
  const out: Record<string, string> = {}

  for (const row of rows) {
    try {
      out[row.name] = row.secret
        ? openSecret(row.value, secretKey())
        : row.value
    } catch {
      // A value sealed with another key reads as not set.
    }
  }

  return out
}

type Declared = Pick<
  ExtensionConnectorDeclaration | ExtensionNotificationChannelDeclaration,
  'settings'
>

/** What the page may show for a declaration: each setting and whether it is set. */
export function describeSettings(
  declaration: Declared,
  stored: readonly StoredSetting[],
) {
  return declaration.settings.map((setting) => {
    const row = stored.find((entry) => entry.name === setting.name)

    return {
      name: setting.name,
      label: setting.label,
      secret: setting.secret,
      required: setting.required,
      isSet: Boolean(row),
      // A secret is never read back.
      value: row && !setting.secret ? row.value : null,
    }
  })
}
