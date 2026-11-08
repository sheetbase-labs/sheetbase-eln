/**
 * Brings a plugin's search index up to date for records that were saved before
 * the plugin was added (or before its hook changed). It runs the plugin's
 * `after` record hooks over the records they cover, as the person asking, and
 * keeps only the index entries they answer with: no notes, flags or field
 * changes. Safe to run again. Server-only.
 */
import { createServerDataClient } from '../connectors/enterprise/execution.server'
import type { DataClient } from '../data-client'
import { logger } from '../logger'
import {
  realSessionAuthDeps,
  requestErrorResponse,
  resolveSessionAuth,
} from '../request-auth'
import type { SessionAuthDeps } from '../request-auth'
import { runExtensionRecordHook } from './data-runtime.server'
import type { RecordSnapshot } from './hook-answers'
import {
  applyHookAnswer,
  clearRecordHookCache,
  defaultRecordHookDeps,
} from './record-hooks.server'
import type { RecordHookDeps } from './record-hooks.server'

const PAGE = 200
const WORKERS = 4
const SELECT =
  'id,identifier,kind,title,status,tags,properties,custom_fields,project_id'

export interface ReindexResult {
  /** Records the plugin put in its index. */
  indexed: number
  /** Records its hook had nothing to say about, or that failed. */
  skipped: number
}

export async function reindexPlugin(
  client: DataClient,
  caller: { workspaceId: string; actorUserId: string },
  extensionKey: string,
  deps: RecordHookDeps = defaultRecordHookDeps(),
): Promise<ReindexResult> {
  clearRecordHookCache()
  const hooks = (await deps.hooksFor(caller.workspaceId)).filter(
    (hook) =>
      hook.extensionKey === extensionKey && hook.declaration.timing === 'after',
  )
  const result: ReindexResult = { indexed: 0, skipped: 0 }
  for (const hook of hooks) {
    const kinds = hook.declaration.kinds
    const filter = kinds?.length
      ? `&kind=in.(${kinds.map(encodeURIComponent).join(',')})`
      : ''
    for (let offset = 0; ; offset += PAGE) {
      const page = await client.list<RecordSnapshot>(
        'records',
        `?select=${SELECT}&deleted_at=is.null${filter}&order=created_at.asc&limit=${PAGE}&offset=${offset}`,
      )
      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(WORKERS, page.length) }, async () => {
          while (next < page.length) {
            const record = page[next++]
            try {
              const answer = await runExtensionRecordHook(
                {
                  workspaceId: caller.workspaceId,
                  actorUserId: caller.actorUserId,
                  extensionKey,
                  hookId: hook.id,
                  timing: 'after',
                  input: {
                    when: 'edited',
                    record,
                    previous: null,
                    changed: [],
                    changes: {},
                    file: null,
                  },
                },
                deps.runtime,
              )
              if (!answer.index?.length || !record.id) {
                result.skipped++
                continue
              }
              await applyHookAnswer(
                deps.store,
                {
                  workspaceId: caller.workspaceId,
                  actorUserId: caller.actorUserId,
                  recordId: record.id,
                  eventId: null,
                  hook,
                },
                { index: answer.index },
              )
              result.indexed++
            } catch (error) {
              result.skipped++
              logger.warn('plugin reindex skipped a record', {
                plugin: extensionKey,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }),
      )
      if (page.length < PAGE) break
    }
  }
  return result
}

/** POST /api/plugins/reindex {extensionKey}: owners and administrators. */
export async function handlePluginReindex(
  request: Request,
  deps: {
    auth: SessionAuthDeps
    makeClient: (token: string) => DataClient
    reindex?: typeof reindexPlugin
  } = { auth: realSessionAuthDeps, makeClient: createServerDataClient },
): Promise<Response> {
  if (request.method !== 'POST')
    return requestErrorResponse(405, 'method_not_allowed', 'Use POST.')
  const auth = await resolveSessionAuth(request.headers, deps.auth)
  if (!auth.ok)
    return requestErrorResponse(auth.status, auth.code, auth.message)
  const { context } = auth
  const body = (await request.json().catch(() => null)) as {
    extensionKey?: unknown
  } | null
  if (
    typeof body?.extensionKey !== 'string' ||
    !/^[a-z][a-z0-9-]{0,48}$/.test(body.extensionKey)
  )
    return requestErrorResponse(400, 'invalid_request', 'Name the plugin.')
  const client = deps.makeClient(context.token)
  try {
    await client.rpc('require_capability', {
      p_workspace_id: context.workspaceId,
      p_capability: 'extensions.manage',
    })
  } catch {
    return requestErrorResponse(
      403,
      'forbidden',
      'Only an owner or administrator can manage plugins.',
    )
  }
  const result = await (deps.reindex ?? reindexPlugin)(
    client,
    { workspaceId: context.workspaceId, actorUserId: context.userId },
    body.extensionKey,
  )
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
