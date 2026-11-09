/**
 * WOPI host for the optional browser editor (Collabora Online). Collabora, not
 * the person's browser, calls these endpoints, so they authenticate with the
 * short-lived access token the app issued for one user and one file instead of
 * a session cookie. Every call turns that token back into the same PostgREST
 * identity the person would have, so row-level security, work permissions,
 * change events and audit attribution apply exactly as for an upload.
 *
 * Saving is `storeFileVersion`: each save becomes a new file version and its
 * text is re-extracted, so search follows the edit. Nothing is overwritten.
 */
import type { ObjectStorage } from '#/lib/file-storage'
import { getObjectStorage } from '#/lib/file-storage'
import { storeFileVersion } from '#/lib/file-routes'
import { verifyWopiToken, wopiLocks } from '#/lib/office-editor'
import type { WopiTokenClaims, WopiLocks } from '#/lib/office-editor'
import { mintPostgrestToken } from '#/lib/postgrest-token'
import { postgrestSelect } from '#/lib/request-auth'

export interface WopiDeps {
  /** PGRST_JWT_SECRET: the key access tokens are derived from. */
  secret: string
  /** Origin of this app, allowed to receive messages from the editor frame. */
  appOrigin: string
  storage?: ObjectStorage
  locks?: WopiLocks
  /** Mints the PostgREST token for a verified WOPI identity. */
  mintToken?: (claims: WopiTokenClaims) => Promise<string>
}

interface FileRow {
  id: string
  storage_key: string
  status: string
  version: number
  display_name: string
  media_type: string
  byte_size: string
  created_at: string
  workspace_id: string
}

const FILE_SELECT =
  'id,storage_key,status,version,display_name,media_type,byte_size,created_at,workspace_id'

function json(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function plain(status: number, headers: HeadersInit = {}) {
  return new Response(null, { status, headers })
}

function tokenFrom(request: Request): string | null {
  const fromQuery = new URL(request.url).searchParams.get('access_token')

  if (fromQuery) return fromQuery
  const auth = request.headers.get('authorization')
  const match = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null

  return match ? match[1] : null
}

interface Resolved {
  claims: WopiTokenClaims
  pgToken: string
  file: FileRow
}

async function resolve(
  request: Request,
  fileRecordId: string,
  deps: WopiDeps,
): Promise<Resolved | Response> {
  const raw = tokenFrom(request)
  const claims = raw ? await verifyWopiToken(deps.secret, raw) : null

  if (!claims || claims.fileRecordId !== fileRecordId) {
    return json(401, { error: 'invalid or expired access token' })
  }

  const pgToken = await (deps.mintToken
    ? deps.mintToken(claims)
    : mintPostgrestToken(deps.secret, {
        userId: claims.userId,
        workspaceId: claims.workspaceId,
        sessionId: claims.sessionId,
      }))

  const res = await postgrestSelect<FileRow[]>(
    'file_objects',
    `record_id=eq.${encodeURIComponent(fileRecordId)}&select=${FILE_SELECT}&order=version.desc&limit=1`,
    pgToken,
  )

  const file = Array.isArray(res.body) ? res.body.at(0) : undefined

  if (res.status >= 400 || !file) return json(404, { error: 'file not found' })

  if (file.status !== 'active') {
    return json(409, { error: `file is ${file.status}` })
  }

  return { claims, pgToken, file }
}

/**
 * Whether the record the file was opened from still accepts edits. A token is
 * issued for an editable record, but the record can be signed or archived
 * while the editor stays open; a save then has to be refused.
 */
async function hostStillEditable(
  claims: WopiTokenClaims,
  pgToken: string,
): Promise<boolean> {
  if (!claims.hostRecordId) return true

  const res = await postgrestSelect<
    { locked_at: string | null; archived_at: string | null }[]
  >(
    'records',
    `id=eq.${encodeURIComponent(claims.hostRecordId)}&select=locked_at,archived_at`,
    pgToken,
  )

  const row = Array.isArray(res.body) ? res.body.at(0) : undefined

  return Boolean(row && !row.locked_at && !row.archived_at)
}

/** `GET /api/wopi/files/{id}` — CheckFileInfo. */
export async function handleCheckFileInfo(
  request: Request,
  fileRecordId: string,
  deps: WopiDeps,
): Promise<Response> {
  const resolved = await resolve(request, fileRecordId, deps)

  if (resolved instanceof Response) return resolved
  const { claims, file, pgToken } = resolved
  const canWrite = claims.canWrite && (await hostStillEditable(claims, pgToken))

  return json(200, {
    BaseFileName: file.display_name,
    OwnerId: file.workspace_id,
    Size: Number(file.byte_size),
    UserId: claims.userId,
    UserFriendlyName: claims.userName,
    Version: String(file.version),
    LastModifiedTime: new Date(file.created_at).toISOString(),
    UserCanWrite: canWrite,
    ReadOnly: !canWrite,
    SupportsUpdate: true,
    SupportsLocks: true,
    SupportsGetLock: true,
    UserCanNotWriteRelative: true,
    PostMessageOrigin: deps.appOrigin,
    DisablePrint: false,
    DisableExport: false,
  })
}

/** `GET /api/wopi/files/{id}/contents` — GetFile. */
export async function handleGetFile(
  request: Request,
  fileRecordId: string,
  deps: WopiDeps,
): Promise<Response> {
  const resolved = await resolve(request, fileRecordId, deps)

  if (resolved instanceof Response) return resolved
  const { file } = resolved
  const storage = deps.storage ?? getObjectStorage()
  const head = await storage.head(file.storage_key)

  if (!head) return json(404, { error: 'file bytes are missing' })
  const { stream, byteSize } = await storage.getStream(file.storage_key)

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(byteSize),
      'x-wopi-itemversion': String(file.version),
      'cache-control': 'private, no-store',
    },
  })
}

/** `POST /api/wopi/files/{id}/contents` — PutFile. */
export async function handlePutFile(
  request: Request,
  fileRecordId: string,
  deps: WopiDeps,
): Promise<Response> {
  const resolved = await resolve(request, fileRecordId, deps)

  if (resolved instanceof Response) return resolved
  const { claims, file, pgToken } = resolved
  const locks = deps.locks ?? wopiLocks

  if (!claims.canWrite || !(await hostStillEditable(claims, pgToken))) {
    return json(401, { error: 'this document cannot be edited' })
  }

  const lock = request.headers.get('x-wopi-lock')

  if (!locks.allowsWrite(file.id, lock)) {
    return plain(409, { 'x-wopi-lock': locks.current(file.id) ?? '' })
  }

  const saved = await storeFileVersion({
    context: { workspaceId: claims.workspaceId, token: pgToken },
    current: file,
    displayName: file.display_name,
    mediaType: file.media_type,
    body: request.body,
    storage: deps.storage ?? getObjectStorage(),
    request,
  })

  if (!saved.ok) {
    return json(saved.status === 413 ? 413 : saved.status, {
      error: saved.message,
    })
  }

  return json(
    200,
    { LastModifiedTime: new Date().toISOString() },
    { 'x-wopi-itemversion': String(saved.version ?? file.version + 1) },
  )
}

/** `POST /api/wopi/files/{id}` — LOCK, GET_LOCK, REFRESH_LOCK, UNLOCK. */
export async function handleLockOperation(
  request: Request,
  fileRecordId: string,
  deps: WopiDeps,
): Promise<Response> {
  const resolved = await resolve(request, fileRecordId, deps)

  if (resolved instanceof Response) return resolved
  const { file, claims } = resolved
  const locks = deps.locks ?? wopiLocks
  const override = request.headers.get('x-wopi-override')?.toUpperCase()
  const lock = request.headers.get('x-wopi-lock') ?? ''
  const version = { 'x-wopi-itemversion': String(file.version) }
  const conflict = (held: string) => plain(409, { 'x-wopi-lock': held })

  if (override !== 'GET_LOCK' && !claims.canWrite) {
    return json(401, { error: 'this document cannot be edited' })
  }

  switch (override) {
    case 'LOCK': {
      const oldLock = request.headers.get('x-wopi-oldlock')

      if (oldLock && locks.current(file.id) === oldLock) {
        locks.unlock(file.id, oldLock)
      }

      const result = locks.lock(file.id, lock)

      return result.ok ? plain(200, version) : conflict(result.held)
    }

    case 'GET_LOCK':
      return plain(200, { 'x-wopi-lock': locks.current(file.id) ?? '' })
    case 'REFRESH_LOCK': {
      const result = locks.refresh(file.id, lock)

      return result.ok ? plain(200, version) : conflict(result.held)
    }

    case 'UNLOCK': {
      const result = locks.unlock(file.id, lock)

      return result.ok ? plain(200, version) : conflict(result.held)
    }

    case 'UNLOCK_AND_RELOCK': {
      const oldLock = request.headers.get('x-wopi-oldlock') ?? ''
      const released = locks.unlock(file.id, oldLock)

      if (!released.ok) return conflict(released.held)
      locks.lock(file.id, lock)

      return plain(200, version)
    }

    case 'PUT_RELATIVE':
    case 'RENAME_FILE':
    case 'DELETE':
      return plain(501)
    default:
      return plain(501)
  }
}
