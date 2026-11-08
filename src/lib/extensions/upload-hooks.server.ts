/**
 * Plugin hooks on an upload, called from the file routes.
 *
 * Before the new bytes become the file's current version, the hooks that run
 * before a save can refuse the upload (the bytes are thrown away) or let it
 * through with a word. After it, the hooks that run after a save answer as for
 * any other record. Both are cheap when nothing is switched on: the hooks of a
 * workspace are looked up once every few seconds.
 *
 * A hook that cannot run never blocks an upload.
 */
import type { ObjectStorage } from '#/lib/file-storage'
import { logger } from '#/lib/logger'
import { postgrestSelect } from '#/lib/request-auth'
import type { RecordSnapshot } from './hook-answers'
import {
  claimsOf,
  defaultRecordHookDeps,
  runUploadHooks,
} from './record-hooks.server'
import type { RecordHookDeps } from './record-hooks.server'

export interface UploadHookArgs {
  /** The person's own token. */
  token: string
  /** The file's record. Give this or `fileObjectId`. */
  fileRecordId?: string
  fileObjectId?: string
  displayName: string
  mediaType: string
  byteSize: number
  checksum: string | null
  /** Where the new bytes are, before they are made current. */
  storage: ObjectStorage
  storageKey: string
}

async function snapshotOf(
  token: string,
  recordId: string,
): Promise<RecordSnapshot | null> {
  const found = await postgrestSelect<RecordSnapshot[]>(
    'records',
    `id=eq.${recordId}&select=id,identifier,kind,title,status,tags,properties,custom_fields,project_id`,
    token,
  )
  return Array.isArray(found.body) && found.body[0] ? found.body[0] : null
}

async function readAll(
  storage: ObjectStorage,
  storageKey: string,
): Promise<Uint8Array> {
  const { stream } = await storage.getStream(storageKey)
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function run(
  args: UploadHookArgs,
  timing: 'before' | 'after',
  deps?: RecordHookDeps,
) {
  const claims = claimsOf(args.token)
  if (!claims) return null
  const hookDeps = deps ?? defaultRecordHookDeps()
  // Nothing switched on for uploads: no further reads at all.
  const hooks = await hookDeps.hooksFor(claims.workspaceId)
  if (
    !hooks.some(
      (hook) =>
        hook.declaration.timing === timing &&
        hook.declaration.when.includes('uploaded'),
    )
  )
    return null
  let recordId = args.fileRecordId
  if (!recordId && args.fileObjectId) {
    const found = await postgrestSelect<Array<{ record_id: string }>>(
      'file_objects',
      `id=eq.${args.fileObjectId}&select=record_id`,
      args.token,
    )
    recordId = Array.isArray(found.body) ? found.body[0]?.record_id : undefined
  }
  if (!recordId) return null
  const record = await snapshotOf(args.token, recordId)
  if (!record) return null
  return runUploadHooks(
    {
      workspaceId: claims.workspaceId,
      actorUserId: claims.actorUserId,
      record,
      file: {
        name: args.displayName,
        media_type: args.mediaType,
        byte_size: args.byteSize,
        checksum: args.checksum,
      },
      readContent: () => readAll(args.storage, args.storageKey),
      timing,
    },
    hookDeps,
  )
}

/** Returns the words to refuse an upload with, or null to let it go on. */
export async function refuseUploadIfAsked(
  args: UploadHookArgs,
  deps?: RecordHookDeps,
): Promise<{ message: string; plugin: string } | null> {
  try {
    const result = await run(args, 'before', deps)
    if (result?.kind === 'refused')
      return { message: result.message, plugin: result.plugin }
  } catch (error) {
    logger.warn('plugin upload hooks could not run before an upload', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return null
}

/** Runs the hooks that follow an upload. Never throws and is not waited for by the caller's response. */
export async function afterUpload(
  args: UploadHookArgs,
  deps?: RecordHookDeps,
): Promise<void> {
  try {
    await run(args, 'after', deps)
  } catch (error) {
    logger.warn('plugin upload hooks could not run after an upload', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
