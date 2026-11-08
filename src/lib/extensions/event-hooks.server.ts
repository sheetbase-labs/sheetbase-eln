/**
 * Plugin reactions to events. When something happens in the workspace, every
 * enabled plugin reaction listening for that event runs, and what it answers
 * becomes notes in the Inbox of the person whose change set it off.
 *
 * A reaction cannot change anything: it is handed the same event a webhook
 * would carry and can only answer with notes. A reaction that fails costs only
 * its own notes, and a plugin's own audit events never set reactions off.
 */
import { sql } from 'drizzle-orm'

import { logger } from '#/lib/logger'
import { runExtensionEventHook } from './data-runtime.server'
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
}

export interface EventHookDeps {
  runtime?: ExtensionRuntimeDeps
  /** The reactions switched on in a workspace for an event. */
  hooksFor: (workspaceId: string, eventName: string) => Promise<Hook[]>
  saveNote: (note: {
    workspaceId: string
    userId: string
    hook: Hook
    eventId: string
    recordId: string | null
    title: string
    body: string | null
  }) => Promise<void>
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
    saveNote: async (note) => {
      const { db } = await import('#/db/client.server')
      await db.execute(
        sql`INSERT INTO api.plugin_notes
              (workspace_id, user_id, extension_key, extension_name, hook_id, event_id, title, body, record_id)
            VALUES (${note.workspaceId}::uuid, ${note.userId}, ${note.hook.extensionKey}, ${note.hook.extensionName},
                    ${note.hook.id}, ${note.eventId}::uuid, ${note.title}, ${note.body}, ${note.recordId}::uuid)
            ON CONFLICT DO NOTHING`,
      )
    },
  }
}

/** Runs the reactions for one event. Never throws: a reaction must not hold up delivery. */
export async function runEventHooks(
  event: HookEvent,
  deps: EventHookDeps = defaultEventHookDeps(),
): Promise<number> {
  // A plugin's own audit events must not set reactions off, or one could feed itself.
  if (event.entityType === 'extension') return 0
  let saved = 0
  try {
    const hooks = await deps.hooksFor(event.workspaceId, event.name)
    if (hooks.length === 0) return 0
    // Notes go to the person whose change it was; a change with no person has nobody to tell.
    if (!event.actorUserId) return 0
    for (const hook of hooks) {
      try {
        const notes = await runExtensionEventHook(
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
          },
          deps.runtime,
        )
        for (const note of notes) {
          await deps.saveNote({
            workspaceId: event.workspaceId,
            userId: event.actorUserId,
            hook,
            eventId: event.id,
            recordId: event.recordId,
            title: note.title,
            body: note.body,
          })
          saved += 1
        }
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
  return saved
}
