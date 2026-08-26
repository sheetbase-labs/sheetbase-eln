import * as React from 'react'

import { useUpdateMyPresence } from '#/lib/collaboration/liveblocks.config'
import type {
  ActiveObjectRef,
  CollaborationPresence,
} from '#/lib/collaboration/types'

import { useCollaborationRoomReady } from './collaboration-room'

/**
 * COLLAB-01 presence self-reporting. Presence is ephemeral awareness only —
 * never authoritative, never a lock — so this module only ever writes the
 * awareness fields; no canonical state can change because of it.
 */

export interface SettablePresenceFields {
  activeObject?: ActiveObjectRef
  activeBlockId?: string | null
  activeFieldId?: string | null
  mode?: 'viewing' | 'editing'
}

/** Defaults restored on cleanup while staying inside the same room. */
const PRESENCE_DEFAULTS: SettablePresenceFields = {
  activeBlockId: null,
  activeFieldId: null,
  mode: 'viewing',
}

/**
 * Stable serialisation of the fields: callers pass inline object literals
 * that differ every render, so effects key off the semantic identity.
 */
function presenceSyncKey(fields: SettablePresenceFields): string {
  return JSON.stringify([
    fields.activeObject ?? null,
    fields.activeBlockId ?? null,
    fields.activeFieldId ?? null,
    fields.mode ?? null,
  ])
}

/**
 * Raw effect hook: reports `fields` as my presence on mount (and whenever
 * their semantic identity changes) and restores the defaults on unmount.
 * MUST run only inside a mounted `CollaborationRoom` — same contract as
 * every other suspense room hook in this codebase. Gated callers should
 * use `PresenceSync` instead, which owns the readiness check.
 *
 * `activeObject` is deliberately absent from the restore defaults: presence
 * is room-scoped, so leaving a room discards it wholesale; only block- and
 * field-level awareness survives within one room and needs explicit reset.
 */
export function useSetPresence(fields: SettablePresenceFields): void {
  // Liveblocks validates the global Presence override with `extends
  // JsonObject`, which no interface satisfies (interfaces lack implicit
  // index signatures), so the hook's patch parameter degrades to an error
  // brand. Cast to the real contract — runtime accepts any JSON partial.
  const updateMyPresence = useUpdateMyPresence() as unknown as (
    patch: Partial<CollaborationPresence>,
  ) => void
  const fieldsRef = React.useRef(fields)
  fieldsRef.current = fields

  React.useEffect(() => {
    updateMyPresence(fieldsRef.current)
    // The semantic field identity is the dependency, not the literal.
  }, [updateMyPresence, presenceSyncKey(fields)])

  React.useEffect(() => {
    return () => {
      updateMyPresence(PRESENCE_DEFAULTS)
    }
  }, [updateMyPresence])
}

/**
 * Room-ready gate around `useSetPresence`, for surfaces that render both
 * inside and outside rooms (the notebook document, toolbars). Renders an
 * effect-only child once the enclosing CollaborationRoom has mounted and
 * null before that, keeping SSR output stable and every room hook behind
 * the provider.
 */
export function PresenceSync(
  props: SettablePresenceFields,
): React.ReactElement | null {
  const ready = useCollaborationRoomReady()
  if (!ready) return null
  return React.createElement(PresenceSyncEffect, props)
}

function PresenceSyncEffect(props: SettablePresenceFields): null {
  useSetPresence(props)
  return null
}
