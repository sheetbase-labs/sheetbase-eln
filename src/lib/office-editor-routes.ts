/**
 * `/api/office-editor/*` — the session-authenticated side of the browser
 * editor. The browser asks for an editing session for a file; the answer is
 * the editor's address and a short-lived WOPI access token for that user and
 * file. Read-only whenever the experiment holding the file is signed or
 * archived: a signed record changes only through an amendment.
 */
import { env } from '#/env.server'
import {
  WOPI_TOKEN_TTL_SECONDS,
  editableExtension,
  editorActionUrl,
  editorFormAction,
  fetchDiscovery,
  officeEditorConfig,
  signWopiToken,
} from '#/lib/office-editor'
import type { OfficeEditorConfig } from '#/lib/office-editor'
import {
  postgrestSelect,
  requestErrorResponse,
  resolveSessionAuth,
} from '#/lib/request-auth'
import type { SessionAuthDeps } from '#/lib/request-auth'

export interface EditorSessionDeps {
  config: OfficeEditorConfig | null
  secret: string
  discovery?: (editorUrl: string) => Promise<string>
}

export const realEditorSessionDeps = (): EditorSessionDeps => ({
  config: officeEditorConfig(env),
  secret: env.PGRST_JWT_SECRET,
})

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

/** `GET /api/office-editor/status` — whether the editor is switched on. */
export async function handleEditorStatus(
  request: Request,
  auth: SessionAuthDeps,
  deps: EditorSessionDeps = realEditorSessionDeps(),
): Promise<Response> {
  const session = await resolveSessionAuth(request.headers, auth)

  if (!session.ok) {
    return requestErrorResponse(session.status, session.code, session.message)
  }

  if (!deps.config) return ok({ enabled: false })

  // `?check=1` also asks the editor whether it answers, for the admin view.
  if (new URL(request.url).searchParams.get('check') !== '1') {
    return ok({ enabled: true })
  }

  let reachable = true

  try {
    await (deps.discovery ?? fetchDiscovery)(deps.config.editorUrl)
  } catch {
    reachable = false
  }

  return ok({
    enabled: true,
    reachable,
    editorOrigin: new URL(deps.config.editorUrl).origin,
  })
}

interface FileInfo {
  display_name: string
  version: number
  status: string
}

/**
 * `POST /api/office-editor/session` with `{ fileRecordId, recordId?, mode? }`.
 * `recordId` is the experiment the file sits in; with it the session is
 * read-only once that experiment is signed or archived. `mode: 'view'` asks for
 * the editor's exact-look viewer instead of an editing session.
 */
export async function handleEditorSession(
  request: Request,
  auth: SessionAuthDeps,
  deps: EditorSessionDeps = realEditorSessionDeps(),
): Promise<Response> {
  if (request.method !== 'POST') {
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  }

  const session = await resolveSessionAuth(request.headers, auth)

  if (!session.ok) {
    return requestErrorResponse(session.status, session.code, session.message)
  }

  const { context } = session

  if (!deps.config) {
    return requestErrorResponse(
      404,
      'editor_off',
      'The browser editor is not set up for this workspace.',
    )
  }

  let body: { fileRecordId?: unknown; recordId?: unknown; mode?: unknown }

  try {
    body = await request.json()
  } catch {
    return requestErrorResponse(400, 'invalid_body', 'Body must be JSON.')
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (typeof body.fileRecordId !== 'string' || !uuid.test(body.fileRecordId)) {
    return requestErrorResponse(
      400,
      'invalid_body',
      'fileRecordId is required.',
    )
  }

  const recordId =
    typeof body.recordId === 'string' && uuid.test(body.recordId)
      ? body.recordId
      : undefined

  const wantView = body.mode === 'view'

  const fileRes = await postgrestSelect<FileInfo[]>(
    'file_objects',
    `record_id=eq.${body.fileRecordId}&select=display_name,version,status&order=version.desc&limit=1`,
    context.token,
  )

  const file = Array.isArray(fileRes.body) ? fileRes.body.at(0) : undefined

  if (fileRes.status >= 400 || !file) {
    return requestErrorResponse(404, 'not_found', 'File not found.')
  }

  if (file.status !== 'active') {
    return requestErrorResponse(409, 'not_available', `File is ${file.status}.`)
  }

  const ext = editableExtension(file.display_name)

  if (!ext) {
    return requestErrorResponse(
      415,
      'not_editable',
      'The browser editor opens Word, Excel, PowerPoint and OpenDocument files.',
    )
  }

  let canWrite = !wantView
  let lockedReason: 'signed' | 'archived' | null = null

  if (recordId) {
    const blockRes = await postgrestSelect<{ id: string }[]>(
      'blocks',
      `record_id=eq.${recordId}&type=eq.file&payload->>fileRecordId=eq.${body.fileRecordId}&select=id&limit=1`,
      context.token,
    )

    if (!Array.isArray(blockRes.body) || blockRes.body.length === 0) {
      return requestErrorResponse(
        404,
        'not_in_record',
        'That file is not in this experiment.',
      )
    }

    const recRes = await postgrestSelect<
      { locked_at: string | null; archived_at: string | null }[]
    >(
      'records',
      `id=eq.${recordId}&select=locked_at,archived_at`,
      context.token,
    )

    const rec = Array.isArray(recRes.body) ? recRes.body.at(0) : undefined

    if (!rec) return requestErrorResponse(404, 'not_found', 'Record not found.')

    if (rec.locked_at) lockedReason = 'signed'
    else if (rec.archived_at) lockedReason = 'archived'

    if (lockedReason) canWrite = false
  }

  let urlsrc: string | null

  try {
    const xml = await (deps.discovery ?? fetchDiscovery)(deps.config.editorUrl)
    urlsrc =
      (canWrite ? editorActionUrl(xml, ext, 'edit') : null) ??
      editorActionUrl(xml, ext, 'view') ??
      editorActionUrl(xml, ext, 'edit')
  } catch {
    return requestErrorResponse(
      502,
      'editor_unreachable',
      'The browser editor did not answer. Check that it is running.',
    )
  }

  if (!urlsrc) {
    return requestErrorResponse(
      415,
      'not_editable',
      'The editor does not open this kind of file.',
    )
  }

  const accessToken = await signWopiToken(deps.secret, {
    fileRecordId: body.fileRecordId,
    userId: context.userId,
    userName: context.userId,
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    canWrite,
    hostRecordId: recordId,
  })

  const wopiSrc = `${deps.config.wopiHostUrl}/api/wopi/files/${body.fileRecordId}`

  return ok({
    actionUrl: editorFormAction(urlsrc, wopiSrc),
    accessToken,
    accessTokenTtl: Date.now() + WOPI_TOKEN_TTL_SECONDS * 1000,
    editorOrigin: new URL(deps.config.editorUrl).origin,
    canEdit: canWrite,
    lockedReason,
    fileName: file.display_name,
    version: file.version,
  })
}
