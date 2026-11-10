/**
 * The lab logo's byte routes. The logo is the workspace's own: it is stored
 * through the same object-storage layer as files, and its pointer lives on the
 * workspace row, set and cleared by RPCs that only an owner or admin may call.
 *
 * - `PUT /api/workspace-logo` stores a new logo (PNG or JPEG, up to
 *   `LOGO_MAX_BYTES`) and removes the one it replaces.
 * - `DELETE /api/workspace-logo` removes it.
 * - `GET /api/workspace-logo` serves it. A signed-in member gets their active
 *   workspace's logo. Anyone else gets the install's logo, because the sign-in
 *   page shows it before anyone is signed in.
 *
 * PNG and JPEG only: those are the two formats a PDF can embed, and the same
 * file is used on screen, in printouts and in PDF reports.
 */
import { webcrypto } from 'node:crypto'

import { z } from 'zod'

import type { ObjectStorage } from '#/lib/file-storage'
import { getObjectStorage, OversizeError } from '#/lib/file-storage'
import {
  postgrestRpc,
  requestErrorResponse,
  resolveSessionAuth,
} from '#/lib/request-auth'
import type { SessionAuthDeps } from '#/lib/request-auth'
import { logger } from '#/lib/logger'

export const LOGO_MAX_BYTES = 1024 * 1024

export type LogoMediaType = 'image/png' | 'image/jpeg'

/** Reads the image type from the leading bytes, never from the request. */
export function sniffLogoType(bytes: Uint8Array): LogoMediaType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  return null
}

/** `logos/<workspaceId>/<random32hex>`; the database checks the same shape. */
export function logoStorageKey(workspaceId: string): string {
  return `logos/${workspaceId}/${webcrypto.randomUUID().replace(/-/g, '')}`
}

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break
    total += value.byteLength

    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new OversizeError(`logo exceeds ${maxBytes} bytes`, maxBytes)
    }

    parts.push(value)
  }

  const joined = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    joined.set(part, offset)
    offset += part.byteLength
  }

  return joined
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength) controller.enqueue(bytes)
      controller.close()
    },
  })
}

/** The key `clear_workspace_logo` hands back for the logo it replaced. */
const replacedLogoKey = z.string().startsWith('logos/')

async function removeQuietly(storage: ObjectStorage, key: string | null) {
  if (!key) return
  await storage.delete(key).catch((error) => {
    logger.warn('old lab logo not removed', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

/** `PUT` and `DELETE /api/workspace-logo`. */
export async function handleLogoWrite(
  request: Request,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use PUT or DELETE.')
  }

  const auth = await resolveSessionAuth(request.headers, deps)

  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth

  if (request.method === 'DELETE') {
    const cleared = await postgrestRpc(
      'clear_workspace_logo',
      { p_workspace_id: context.workspaceId },
      context.token,
    )

    if (cleared.status >= 400) {
      return requestErrorResponse(
        cleared.status === 403 ? 403 : cleared.status,
        'logo_not_removed',
        'Only an administrator can remove the lab logo.',
      )
    }

    const replaced = replacedLogoKey.safeParse(cleared.body)

    await removeQuietly(storage, replaced.success ? replaced.data : null)

    return new Response(null, { status: 204 })
  }

  let bytes: Uint8Array

  try {
    bytes = await readCapped(request.body, LOGO_MAX_BYTES)
  } catch (error) {
    if (error instanceof OversizeError) {
      return requestErrorResponse(413, 'oversize', 'Choose a logo under 1 MB.')
    }

    throw error
  }

  const mediaType = sniffLogoType(bytes)

  if (!mediaType) {
    return requestErrorResponse(
      415,
      'unsupported_image',
      'Use a PNG or JPEG image.',
    )
  }

  const key = logoStorageKey(context.workspaceId)
  await storage.putStream(key, streamOf(bytes), LOGO_MAX_BYTES)

  const saved = await postgrestRpc(
    'set_workspace_logo',
    {
      p_workspace_id: context.workspaceId,
      p_storage_key: key,
      p_media_type: mediaType,
    },
    context.token,
  )

  if (saved.status >= 400) {
    await removeQuietly(storage, key)

    return requestErrorResponse(
      saved.status,
      'logo_not_saved',
      'Only an administrator can change the lab logo.',
    )
  }

  const removed = replacedLogoKey.safeParse(saved.body)

  await removeQuietly(storage, removed.success ? removed.data : null)

  return new Response(JSON.stringify({ mediaType }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export interface LogoLookup {
  storageKey: string
  mediaType: string
}

/**
 * Where the logo is kept. A member reads their active workspace's through the
 * database's own rules; with no session, the install's oldest logo.
 */
export async function findLogo(
  request: Request,
  deps: SessionAuthDeps,
  anonymous: () => Promise<LogoLookup | null>,
): Promise<LogoLookup | null> {
  const auth = await resolveSessionAuth(request.headers, deps)

  if (!auth.ok) return anonymous()

  const found = await postgrestRpc<
    Array<{ storage_key: string; media_type: string }>
  >('workspace_logo', {}, auth.context.token)

  const row = Array.isArray(found.body) ? found.body[0] : undefined

  if (found.status >= 400 || !row) return null

  return { storageKey: row.storage_key, mediaType: row.media_type }
}

/** The install's logo, for the pages shown before anyone has signed in. */
export async function anonymousLogo(): Promise<LogoLookup | null> {
  const [{ env }, { getPool }] = await Promise.all([
    import('#/env.server'),
    import('#/db/pool.server'),
  ])

  const { rows } = await getPool(env.DATABASE_URL).query<{
    logo_storage_key: string
    logo_media_type: string
  }>(
    `SELECT logo_storage_key, logo_media_type FROM api.workspaces
      WHERE logo_storage_key IS NOT NULL AND status = 'active'
      ORDER BY created_at LIMIT 1`,
  )

  const row = rows.at(0)

  return row
    ? { storageKey: row.logo_storage_key, mediaType: row.logo_media_type }
    : null
}

/** `GET /api/workspace-logo`. */
export async function handleLogoDownload(
  request: Request,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
  anonymous: () => Promise<LogoLookup | null> = anonymousLogo,
): Promise<Response> {
  if (request.method !== 'GET') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use GET.')
  }

  const logo = await findLogo(request, deps, anonymous)

  if (!logo) return requestErrorResponse(404, 'not_found', 'No logo.')
  const head = await storage.head(logo.storageKey)

  if (!head) return requestErrorResponse(404, 'not_found', 'No logo.')
  const { stream, byteSize } = await storage.getStream(logo.storageKey)

  // The page asks with `?v=<version>`, which changes with every new logo, so a
  // long cache never shows a stale one.
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': logo.mediaType,
      'content-length': String(byteSize),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
}

/** The bytes of the signed-in member's workspace logo, for a PDF. */
export async function readWorkspaceLogoBytes(
  workspaceId: string,
  storage: ObjectStorage = getObjectStorage(),
): Promise<{ bytes: Uint8Array; mediaType: LogoMediaType } | null> {
  const [{ env }, { getPool }] = await Promise.all([
    import('#/env.server'),
    import('#/db/pool.server'),
  ])

  const { rows } = await getPool(env.DATABASE_URL).query<{
    logo_storage_key: string
    logo_media_type: LogoMediaType
  }>(
    `SELECT logo_storage_key, logo_media_type FROM api.workspaces
      WHERE id = $1::uuid AND logo_storage_key IS NOT NULL`,
    [workspaceId],
  )

  const row = rows.at(0)

  if (!row || !(await storage.head(row.logo_storage_key))) return null
  const { stream } = await storage.getStream(row.logo_storage_key)

  return {
    bytes: await readCapped(stream, LOGO_MAX_BYTES),
    mediaType: row.logo_media_type,
  }
}
