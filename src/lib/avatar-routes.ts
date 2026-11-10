/**
 * Profile photo byte routes. The photo is a person's own: it is stored through
 * the same object-storage layer as files, and its pointer lives on the
 * caller's `user_preferences` row, set and cleared by RPCs that take the user
 * from the request claims. Co-members of the caller's workspace can read it.
 *
 * - `PUT /api/avatars/me` stores a new photo (PNG, JPEG or WebP, up to
 *   `AVATAR_MAX_BYTES`) and removes the one it replaces.
 * - `DELETE /api/avatars/me` removes the photo.
 * - `GET /api/avatars/{userId}` serves a photo.
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

/** The cropped photo the browser sends is far smaller; this is the hard cap. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export type AvatarMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

/** Reads the image type from the leading bytes, never from the request. */
export function sniffAvatarType(bytes: Uint8Array): AvatarMediaType | null {
  const at = (index: number) => bytes[index]

  if (
    bytes.length >= 8 &&
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return 'image/png'
  }

  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return 'image/jpeg'
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(at(0), at(1), at(2), at(3)) === 'RIFF' &&
    String.fromCharCode(at(8), at(9), at(10), at(11)) === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

/** `avatars/<userId>/<random32hex>`; the database checks the same shape. */
export function avatarStorageKey(userId: string): string {
  return `avatars/${userId}/${webcrypto.randomUUID().replace(/-/g, '')}`
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
      throw new OversizeError(`photo exceeds ${maxBytes} bytes`, maxBytes)
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

function previousKey<Body>(body: Body): string | null {
  return z.string().startsWith('avatars/').safeParse(body).data ?? null
}

/** The message from a caught throw, whose type JavaScript does not narrow. */
function messageOf<Cause>(cause: Cause): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function removeQuietly(storage: ObjectStorage, key: string | null) {
  if (!key) return
  await storage.delete(key).catch((error) => {
    logger.warn('old profile photo not removed', {
      error: messageOf(error),
    })
  })
}

/** `PUT` and `DELETE /api/avatars/me`. */
export async function handleMyAvatar(
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
    const cleared = await postgrestRpc('clear_my_photo', {}, context.token)

    if (cleared.status >= 400) {
      return requestErrorResponse(
        cleared.status,
        'photo_not_removed',
        'Your photo could not be removed.',
      )
    }

    await removeQuietly(storage, previousKey(cleared.body))

    return new Response(null, { status: 204 })
  }

  let bytes: Uint8Array

  try {
    bytes = await readCapped(request.body, AVATAR_MAX_BYTES)
  } catch (error) {
    if (error instanceof OversizeError) {
      return requestErrorResponse(413, 'oversize', 'Choose a photo under 2 MB.')
    }

    throw error
  }

  const mediaType = sniffAvatarType(bytes)

  if (!mediaType) {
    return requestErrorResponse(
      415,
      'unsupported_image',
      'Use a PNG, JPEG or WebP image.',
    )
  }

  const key = avatarStorageKey(context.userId)
  await storage.putStream(key, streamOf(bytes), AVATAR_MAX_BYTES)

  const saved = await postgrestRpc(
    'set_my_photo',
    { p_storage_key: key, p_media_type: mediaType },
    context.token,
  )

  if (saved.status >= 400) {
    await removeQuietly(storage, key)

    return requestErrorResponse(
      saved.status,
      'photo_not_saved',
      'Your photo could not be saved.',
    )
  }

  await removeQuietly(storage, previousKey(saved.body))

  return new Response(JSON.stringify({ mediaType }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** `GET /api/avatars/{userId}`. */
export async function handleAvatarDownload(
  request: Request,
  userId: string,
  deps: SessionAuthDeps,
  storage: ObjectStorage = getObjectStorage(),
): Promise<Response> {
  if (request.method !== 'GET') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use GET.')
  }

  const auth = await resolveSessionAuth(request.headers, deps)

  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)

  const found = await postgrestRpc<
    Array<{ storage_key: string; media_type: string }>
  >('member_photo', { p_user_id: userId }, auth.context.token)

  const row = Array.isArray(found.body) ? found.body[0] : undefined

  if (found.status >= 400 || !row) {
    return requestErrorResponse(404, 'not_found', 'No photo.')
  }

  const head = await storage.head(row.storage_key)

  if (!head) return requestErrorResponse(404, 'not_found', 'No photo.')
  const { stream, byteSize } = await storage.getStream(row.storage_key)

  // The client asks with `?v=<version>`, which changes with every new photo,
  // so a long private cache never shows a stale one.
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': row.media_type,
      'content-length': String(byteSize),
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
}
