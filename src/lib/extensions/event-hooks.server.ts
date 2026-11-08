/**
 * Plugin reactions to events. When something happens in the workspace, every
 * enabled plugin reaction listening for that event runs. What it answers is
 * done as the person whose change set it off: notes in their Inbox (14 days),
 * flags a gate waits on, sign-offs for people to press, summaries, search index
 * entries and changes to fields on the record concerned (see `hook-answers.ts`).
 *
 * A reaction that fails costs only its own answer, and a plugin's own audit
 * events and its own writes never set reactions off.
 */
import { logger } from '#/lib/logger'
import { runExtensionEventHook } from './data-runtime.server'
import {
  PLUGIN_CLIENT_ID,
  applyHookAnswer,
  defaultHookStore,
} from './record-hooks.server'
import type { HookStore } from './record-hooks.server'
import type { RecordSnapshot } from './hook-answers'
import { resolveRunnerPoints } from './runner-points'
import type { RunnerItem } from './runner-points'
import type { ExtensionEventHookDeclaration } from './data-points'
import type { ExtensionRuntimeDeps } from './runtime.server'

type Hook = RunnerItem<ExtensionEventHookDeclaration>

export interface HookEvent {
  id: string
  workspaceId: string
  actorUserId: string | null
  recordId: string | null
  entityType: string
  entityId: string
  /** The stable event name, as webhooks use. */
  name: string
  data: unknown
  /** Set when a plugin made the change; such events never set reactions off. */
  clientId?: string | null
}

export interface EventHookDeps {
  runtime?: ExtensionRuntimeDeps
  /** The reactions switched on in a workspace for an event. */
  hooksFor: (workspaceId: string, eventName: string) => Promise<Hook[]>
  /** What a reaction's answer is done with. */
  store: HookStore
  /** The record an event is about, as the person who made the change sees it. */
  loadRecord?: (
    workspaceId: string,
    actorUserId: string,
    recordId: string,
  ) => Promise<RecordSnapshot | null>
}

const CACHE_MS = 10_000
const cache = new Map<string, { at: number; hooks: Hook[] }>()

export function clearEventHookCache(): void {
  cache.clear()
}

export function defaultEventHookDeps(): EventHookDeps {
  return {
    hooksFor: async (workspaceId, eventName) => {
      const hit = cache.get(workspaceId)
      let hooks: Hook[]
      if (hit && Date.now() - hit.at < CACHE_MS) hooks = hit.hooks
      else {
        const { db } = await import('#/db/client.server')
        const { extensions } = await import('#/db/schema')
        const { eq } = await import('drizzle-orm')
        const rows = await db
          .select()
          .from(extensions)
          .where(eq(extensions.workspaceId, workspaceId))
        hooks = resolveRunnerPoints(
          rows.map((row) => ({
            id: row.id,
            key: row.key,
            name: row.name,
            status: row.status,
            manifest: row.manifest as never,
            disabled_points: row.disabledPoints,
          })),
        ).data['event-hooks']
        cache.set(workspaceId, { at: Date.now(), hooks })
      }
      return hooks.filter((hook) => hook.declaration.events.includes(eventName))
    },
    store: defaultHookStore(),
    loadRecord: async (workspaceId, actorUserId, recordId) => {
      const { env } = await import('#/env.server')
      const { mintPostgrestToken } = await import('#/lib/postgrest-token')
      const { postgrestSelect } = await import('#/lib/request-auth')
      const token = await mintPostgrestToken(env.PGRST_JWT_SECRET, {
        userId: actorUserId,
        workspaceId,
        sessionId: 'plugin-hook',
        clientId: PLUGIN_CLIENT_ID,
        ttlSeconds: 60,
      })
      const found = await postgrestSelect<RecordSnapshot[]>(
        'records',
        `id=eq.${recordId}&select=id,identifier,kind,title,status,tags,properties,custom_fields,project_id`,
        token,
      )
      return Array.isArray(found.body) && found.body[0] ? found.body[0] : null
    },
  }
}

/** Runs the reactions for one event. Never throws: a reaction must not hold up delivery. */
export async function runEventHooks(
  event: HookEvent,
  deps: EventHookDeps = defaultEventHookDeps(),
): Promise<number> {
  // A plugin's own audit events and its own writes must not set reactions off,
  // or one could feed itself.
  if (event.entityType === 'extension') return 0
  if (event.clientId === PLUGIN_CLIENT_ID) return 0
  let done = 0
  try {
    const hooks = await deps.hooksFor(event.workspaceId, event.name)
    if (hooks.length === 0) return 0
    // Everything a reaction does is done as the person whose change it was; a
    // change with no person has nobody to do it as.
    if (!event.actorUserId) return 0
    let record: RecordSnapshot | null | undefined
    for (const hook of hooks) {
      try {
        if (record === undefined)
          record =
            event.recordId && deps.loadRecord
              ? await deps
                  .loadRecord(
                    event.workspaceId,
                    event.actorUserId,
                    event.recordId,
                  )
                  .catch(() => null)
              : null
        const answer = await runExtensionEventHook(
          {
            workspaceId: event.workspaceId,
            actorUserId: event.actorUserId,
            extensionKey: hook.extensionKey,
            hookId: hook.id,
            event: {
              name: event.name,
              entityType: event.entityType,
              entityId: event.entityId,
              data: event.data,
            },
            record,
          },
          deps.runtime,
        )
        const outcome = await applyHookAnswer(
          deps.store,
          {
            workspaceId: event.workspaceId,
            actorUserId: event.actorUserId,
            recordId: event.recordId,
            eventId: event.id,
            hook,
          },
          answer,
        )
        done += outcome.done.length
      } catch (error) {
        logger.warn('plugin reaction failed', {
          plugin: hook.extensionKey,
          hook: hook.id,
          event: event.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    logger.warn('plugin reactions could not be looked up', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return done
}
