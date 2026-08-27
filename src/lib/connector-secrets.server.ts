/**
 * INT-01 — sealed connector secrets.
 *
 * Third-party credentials never live in `api.connectors.config` or any JSON a
 * client can read. Values are stored AES-256-GCM encrypted in the internal
 * schema (invisible to PostgREST) and can only be set, rotated or removed via
 * these steward-gated server functions. Plaintext exists transiently
 * server-side and is never returned to any caller.
 *
 * The key is derived from BETTER_AUTH_SECRET with a domain-separated HKDF info
 * string so a future dedicated `SHEETBASE_SECRET_SOURCE` swap does not rederive
 * silently into unreadable ciphertexts.
 */
import { createServerFn } from '@tanstack/react-start'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export const CONNECTOR_SECRET_INFO = 'sheetbase:connector-secrets:v1'
const SALT = new Uint8Array(32).fill(0x1e)

export function deriveConnectorSecretKey(masterSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterSecret, SALT, CONNECTOR_SECRET_INFO, 32))
}

/** Encrypt to a self-contained token: v1.<iv b64>.<authTag b64>.<ciphertext b64>. */
export function sealSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function openSecret(token: string, key: Buffer): string {
  const [version, ivB64, tagB64, dataB64] = token.split('.')
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognised connector secret envelope.')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

async function loadSession(workspaceId: string) {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  const { db } = await import('#/db/client.server')

  const context = await getCurrentContext(getRequestHeaders())
  if (!context) throw new Error('You must be signed in.')
  if (!context.workspace || context.workspace.id !== workspaceId) {
    throw new Error('You do not have access to this workspace.')
  }
  const role: string = context.workspace.role
  if (!['owner', 'admin', 'steward'].includes(role)) {
    throw new Error('Only owners, admins or stewards manage connector secrets.')
  }
  return { db, context }
}

function secretKey(): Buffer {
  const master = process.env.BETTER_AUTH_SECRET
  if (!master || master.length === 0) {
    throw new Error('BETTER_AUTH_SECRET is not configured.')
  }
  return deriveConnectorSecretKey(master)
}

const SECRET_NAME = /^[a-z][a-z0-9_]{0,48}$/

export interface ConnectorSecretEntry {
  secretName: string
  updatedAt: string
}

export const listConnectorSecretNamesFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; connectorId: string }) => input)
  .handler(async ({ data }): Promise<ConnectorSecretEntry[]> => {
    const { db } = await loadSession(data.workspaceId)
    const { connectorSecrets } = await import('#/db/schema')
    const { eq, and } = await import('drizzle-orm')
    const rows = await db
      .select({
        secretName: connectorSecrets.secretName,
        updatedAt: connectorSecrets.updatedAt,
      })
      .from(connectorSecrets)
      .where(
        and(
          eq(connectorSecrets.workspaceId, data.workspaceId),
          eq(connectorSecrets.connectorId, data.connectorId),
        ),
      )
    return rows.map((row) => ({
      secretName: row.secretName,
      updatedAt: row.updatedAt.toISOString(),
    }))
  })

export const setConnectorSecretFn = createServerFn({ method: 'POST' })
  .validator(
    (input: {
      workspaceId: string
      connectorId: string
      secretName: string
      value: string
    }) =>
      input,
  )
  .handler(async ({ data }) => {
    if (!SECRET_NAME.test(data.secretName)) {
      throw new Error(
        'Secret names are lowercase snake_case identifiers (e.g. api_key).',
      )
    }
    if (!data.value.trim()) throw new Error('Secret value cannot be empty.')
    const { db, context } = await loadSession(data.workspaceId)
    const { connectorSecrets, connectors } = await import('#/db/schema')
    const { eq, and } = await import('drizzle-orm')
    // Composite FK enforces this at rest; verify explicitly for a clear error.
    const owned = await db
      .select({ id: connectors.id })
      .from(connectors)
      .where(
        and(
          eq(connectors.id, data.connectorId),
          eq(connectors.workspaceId, data.workspaceId),
        ),
      )
    if (owned.length === 0) {
      throw new Error('Connector not found in this workspace.')
    }
    const sealed = sealSecret(data.value.trim(), secretKey())
    // Insert or rotate. Only the name + timestamp leave this function.
    const existing = await db
      .select({ id: connectorSecrets.id })
      .from(connectorSecrets)
      .where(
        and(
          eq(connectorSecrets.connectorId, data.connectorId),
          eq(connectorSecrets.secretName, data.secretName),
        ),
      )
    if (existing.length > 0) {
      await db
        .update(connectorSecrets)
        .set({ ciphertext: Buffer.from(sealed, 'utf8'), updatedAt: new Date() })
        .where(eq(connectorSecrets.id, existing[0].id))
      return { secretName: data.secretName, rotated: true }
    }
    await db.insert(connectorSecrets).values({
      workspaceId: data.workspaceId,
      connectorId: data.connectorId,
      secretName: data.secretName,
      ciphertext: Buffer.from(sealed, 'utf8'),
      createdByUserId: context.user.id,
    })
    return { secretName: data.secretName, rotated: false }
  })

export const deleteConnectorSecretFn = createServerFn({ method: 'POST' })
  .validator((input: { workspaceId: string; connectorId: string; secretName: string }) => input)
  .handler(async ({ data }) => {
    const { db } = await loadSession(data.workspaceId)
    const { connectorSecrets } = await import('#/db/schema')
    const { eq, and } = await import('drizzle-orm')
    await db
      .delete(connectorSecrets)
      .where(
        and(
          eq(connectorSecrets.connectorId, data.connectorId),
          eq(connectorSecrets.secretName, data.secretName),
        ),
      )
    return { deleted: true }
  })
