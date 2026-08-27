/**
 * INT-01 — sealed connector secrets (server-side).
 *
 * Third-party credentials never live in `api.connectors.config` or any JSON a
 * client can read. Values are stored AES-256-GCM encrypted in the internal
 * schema (invisible to PostgREST) and can only be set, rotated or removed via
 * the steward-gated server functions in `connector-secret-admin.ts`. Plaintext
 * exists transiently server-side and is never returned to any caller.
 *
 * The key is derived from BETTER_AUTH_SECRET with a domain-separated HKDF info
 * string so a future dedicated `SHEETBASE_SECRET_SOURCE` swap does not rederive
 * silently into unreadable ciphertexts.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto'
import { and, eq } from 'drizzle-orm'

export const CONNECTOR_SECRET_INFO = 'sheetbase:connector-secrets:v1'
const SALT = new Uint8Array(32).fill(0x1e)

export function deriveConnectorSecretKey(masterSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterSecret, SALT, CONNECTOR_SECRET_INFO, 32),
  )
}

/** Encrypt to a self-contained token: v1.<iv b64>.<authTag b64>.<ciphertext b64>. */
export function sealSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
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

export function secretKey(): Buffer {
  const master = process.env.BETTER_AUTH_SECRET
  if (!master || master.length === 0) {
    throw new Error('BETTER_AUTH_SECRET is not configured.')
  }
  return deriveConnectorSecretKey(master)
}

const SECRET_NAME = /^[a-z][a-z0-9_]{0,48}$/

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

export interface ConnectorSecretEntry {
  secretName: string
  updatedAt: string
}

export async function listConnectorSecretNames(
  workspaceId: string,
  connectorId: string,
): Promise<ConnectorSecretEntry[]> {
  const { db } = await loadSession(workspaceId)
  const { connectorSecrets } = await import('#/db/schema')
  const rows = await db
    .select({
      secretName: connectorSecrets.secretName,
      updatedAt: connectorSecrets.updatedAt,
    })
    .from(connectorSecrets)
    .where(
      and(
        eq(connectorSecrets.workspaceId, workspaceId),
        eq(connectorSecrets.connectorId, connectorId),
      ),
    )
  return rows.map((row) => ({
    secretName: row.secretName,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function setConnectorSecret(
  workspaceId: string,
  connectorId: string,
  secretName: string,
  value: string,
): Promise<{ secretName: string; rotated: boolean }> {
  if (!SECRET_NAME.test(secretName)) {
    throw new Error(
      'Secret names are lowercase snake_case identifiers (e.g. api_key).',
    )
  }
  const { db, context } = await loadSession(workspaceId)
  const { connectorSecrets, connectors } = await import('#/db/schema')
  // Composite FK enforces this at rest; verify explicitly for a clear error.
  const owned = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(
      and(
        eq(connectors.id, connectorId),
        eq(connectors.workspaceId, workspaceId),
      ),
    )
  if (owned.length === 0) {
    throw new Error('Connector not found in this workspace.')
  }
  const sealed = sealSecret(value.trim(), secretKey())
  // Insert or rotate. Only the name + timestamp leave this function.
  const existing = await db
    .select({ id: connectorSecrets.id })
    .from(connectorSecrets)
    .where(
      and(
        eq(connectorSecrets.connectorId, connectorId),
        eq(connectorSecrets.secretName, secretName),
      ),
    )
  if (existing.length > 0) {
    await db
      .update(connectorSecrets)
      .set({ ciphertext: Buffer.from(sealed, 'utf8'), updatedAt: new Date() })
      .where(eq(connectorSecrets.id, existing[0].id))
    return { secretName, rotated: true }
  }
  await db.insert(connectorSecrets).values({
    workspaceId,
    connectorId,
    secretName,
    ciphertext: Buffer.from(sealed, 'utf8'),
    createdByUserId: context.user.id,
  })
  return { secretName, rotated: false }
}

export async function deleteConnectorSecret(
  workspaceId: string,
  connectorId: string,
  secretName: string,
): Promise<{ deleted: boolean }> {
  const { db } = await loadSession(workspaceId)
  const { connectorSecrets } = await import('#/db/schema')
  await db
    .delete(connectorSecrets)
    .where(
      and(
        eq(connectorSecrets.connectorId, connectorId),
        eq(connectorSecrets.secretName, secretName),
      ),
    )
  return { deleted: true }
}
