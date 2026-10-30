/**
 * Byte routes for the whole-workspace export and for stored backups.
 *
 * Same architecture as `src/lib/export/routes.ts`: thin route files delegate
 * here with injected dependencies so tests can stub the session and storage.
 * Both need the Backups and export settings area at "manage": an archive holds
 * everything the workspace has, so it is not something a viewer can pull.
 * Every download writes a receipt into api.data_exports.
 */
import { requestErrorResponse, resolveSessionAuth } from '#/lib/request-auth'
import type { SessionAuthDeps } from '#/lib/request-auth'

import { createWorkspaceArchive } from './archive.server'
import type { ArchiveSummary } from './archive.server'
import { findBackup } from './backup.server'
import type { BackupDeps } from './backup.server'

export interface WorkspaceExportRouteDeps {
  auth: SessionAuthDeps
  /** Whether this person may manage the Backups and export area. */
  canManage: (userId: string, workspaceId: string) => Promise<boolean>
  backup: () => BackupDeps
}

function notAllowed(): Response {
  return requestErrorResponse(
    403,
    'forbidden',
    'Only people who can manage backups and export can download a workspace archive.',
  )
}

async function authorise(
  request: Request,
  deps: WorkspaceExportRouteDeps,
): Promise<
  | { ok: true; userId: string; workspaceId: string }
  | { ok: false; response: Response }
> {
  const auth = await resolveSessionAuth(request.headers, deps.auth)
  if (!auth.ok) {
    return {
      ok: false,
      response: requestErrorResponse(auth.status, auth.code, auth.message),
    }
  }
  const { userId, workspaceId } = auth.context
  if (!(await deps.canManage(userId, workspaceId))) {
    return { ok: false, response: notAllowed() }
  }
  return { ok: true, userId, workspaceId }
}

function archiveFilename(slug: string, when: Date): string {
  const day = when.toISOString().slice(0, 10).replace(/-/g, '')
  const safe = slug.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '')
  return `sheetbase-${safe || 'workspace'}-${day}.zip`
}

async function workspaceSlug(
  deps: BackupDeps,
  workspaceId: string,
): Promise<string> {
  const { rows } = await deps.pool.query(
    'SELECT slug FROM api.workspaces WHERE id = $1::uuid',
    [workspaceId],
  )
  return (rows[0]?.slug as string | undefined) ?? 'workspace'
}

async function recordReceipt(
  deps: BackupDeps,
  input: {
    workspaceId: string
    userId: string
    objectId: string
    format: string
    rowCount: number | null
    byteSize: number | null
  },
): Promise<void> {
  await deps.pool.query(
    `INSERT INTO api.data_exports
       (workspace_id, object_type, object_id, format, row_count, byte_size, actor_user_id)
     VALUES ($1::uuid, 'workspace', $2::uuid, $3, $4, $5, $6)`,
    [
      input.workspaceId,
      input.objectId,
      input.format,
      input.rowCount === null ? null : Math.min(input.rowCount, 2_147_483_647),
      input.byteSize,
      input.userId,
    ],
  )
}

/**
 * Closes the response only after the receipt is written, so a download that
 * the audit trail cannot account for ends in an error, never a clean finish.
 */
function closingWithReceipt(
  source: ReadableStream<Uint8Array>,
  finish: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (!done) {
        controller.enqueue(value)
        return
      }
      try {
        await finish()
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
}

/** GET /api/export/workspace: a fresh archive of the whole workspace. */
export async function handleWorkspaceExport(
  request: Request,
  deps: WorkspaceExportRouteDeps,
): Promise<Response> {
  const who = await authorise(request, deps)
  if (!who.ok) return who.response
  const backup = deps.backup()
  const objectId = crypto.randomUUID()
  const { stream, summary } = createWorkspaceArchive(who.workspaceId, {
    ...backup.archive,
    now: backup.now,
  })
  let bytes = 0
  const counted = stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
  const body = closingWithReceipt(counted, async () => {
    const counts: ArchiveSummary = await summary
    await recordReceipt(backup, {
      workspaceId: who.workspaceId,
      userId: who.userId,
      objectId,
      format: 'zip',
      rowCount: counts.rowCount,
      byteSize: bytes,
    })
  })
  return new Response(body, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${archiveFilename(
        await workspaceSlug(backup, who.workspaceId),
        backup.now(),
      )}"`,
      'cache-control': 'no-store',
    },
  })
}

/** GET /api/export/workspace-backup/:id: a stored backup, as it was made. */
export async function handleBackupDownload(
  request: Request,
  backupId: string,
  deps: WorkspaceExportRouteDeps,
): Promise<Response> {
  const who = await authorise(request, deps)
  if (!who.ok) return who.response
  if (!/^[0-9a-f-]{36}$/i.test(backupId)) {
    return requestErrorResponse(404, 'not_found', 'Backup not found.')
  }
  const backup = deps.backup()
  const found = await findBackup(backup.pool, who.workspaceId, backupId)
  if (!found || found.status !== 'succeeded' || !found.storageKey) {
    return requestErrorResponse(404, 'not_found', 'Backup not found.')
  }
  let opened
  try {
    opened = await backup.destination.storage.getStream(found.storageKey)
  } catch {
    return requestErrorResponse(
      404,
      'not_found',
      'This backup is no longer in storage.',
    )
  }
  await recordReceipt(backup, {
    workspaceId: who.workspaceId,
    userId: who.userId,
    objectId: found.id,
    format: 'backup-download',
    rowCount: found.rowCount,
    byteSize: found.byteSize,
  })
  return new Response(opened.stream, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(opened.byteSize),
      'content-disposition': `attachment; filename="${archiveFilename(
        await workspaceSlug(backup, who.workspaceId),
        new Date(found.startedAt),
      )}"`,
      'cache-control': 'no-store',
    },
  })
}
