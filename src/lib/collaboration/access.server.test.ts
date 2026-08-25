// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import type { CollaborationAuthDeps } from './access.server'
import { resolveRoomAccess } from './access.server'

// Server modules validate environment at import time; seed the minimum
// before any import is evaluated. Nothing here connects to a database.
vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'postgres://localhost:5432/sheetbase-test'
  process.env.FORMULA_DATABASE_URL ||= 'postgres://localhost:5432/formula-test'
  process.env.BETTER_AUTH_SECRET ||= 'test-secret-with-32-characters-minimum!!'
  process.env.PGRST_JWT_SECRET ||= 'test-secret-with-32-characters-minimum!!'
  process.env.LIVEBLOCKS_SECRET_KEY ||=
    'test-secret-with-32-characters-minimum!!'
})

const WS = 'a0000000-0000-7000-8000-000000000001'
const OTHER_WS = 'a0000000-0000-7000-8000-00000000ffff'
const RECORD = 'b0000000-0000-7000-8000-000000000002'

const ROOM = `workspace:${WS}:record:${RECORD}`

type ObjectState = 'writable' | 'read_only' | 'denied'

function makeDeps(overrides: {
  userId?: string
  membershipRole?: string | null
  suspended?: boolean
  objectLivesIn?: string
  workspaceStatus?: string | null
  /** Lifecycle of the object when it lives in the expected workspace. */
  objectState?: ObjectState
}): CollaborationAuthDeps {
  const membershipRole =
    'membershipRole' in overrides
      ? (overrides.membershipRole as string | null)
      : 'scientist'
  return {
    getSession: async () => ({
      user: { id: overrides.userId ?? 'user-1', name: 'Ada', email: 'a@x.io' },
      session: { id: 'session-1' },
    }),
    getMembership: async (_userId, workspaceId) =>
      workspaceId === (overrides.objectLivesIn ?? WS) && membershipRole
        ? {
            role: membershipRole,
            suspendedAt: overrides.suspended ? new Date() : null,
          }
        : null,
    objectState: async (_kind, workspaceId) =>
      workspaceId === (overrides.objectLivesIn ?? WS)
        ? (overrides.objectState ?? 'writable')
        : 'denied',
    getWorkspaceStatus: async () => overrides.workspaceStatus ?? 'active',
    getUserAvatar: async () => null,
  }
}

describe('collaboration room access resolution', () => {
  it('authenticates through the Sheetbase session and grants scoped access', async () => {
    const result = await resolveRoomAccess(new Headers(), ROOM, makeDeps({}))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.userId).toBe('user-1')
      expect(result.userInfo.name).toBe('Ada')
      expect(result.permissions.permissions).toContain('comments:write')
    }
  })

  it('denies cross-workspace rooms even when the id parses', async () => {
    const foreignRoom = `workspace:${OTHER_WS}:record:${RECORD}`
    const deps = makeDeps({ objectLivesIn: WS })
    const result = await resolveRoomAccess(new Headers(), foreignRoom, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('forbidden')
  })

  it('denies non-members and suspended members', async () => {
    const noMember = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ membershipRole: null }),
    )
    expect(noMember.ok).toBe(false)

    const suspended = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ suspended: true }),
    )
    expect(suspended.ok).toBe(false)
    if (!suspended.ok) expect(suspended.code).toBe('membership_suspended')
  })

  it('gives viewers read-only scopes, never comment write', async () => {
    const result = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ membershipRole: 'viewer' }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.permissions.permissions).toContain('room:read')
      expect(result.permissions.permissions).not.toContain('comments:write')
    }
  })

  it('denies inactive workspaces, deleted and unknown objects', async () => {
    const archived = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ workspaceStatus: 'archived' }),
    )
    expect(archived.ok).toBe(false)
    if (!archived.ok) expect(archived.code).toBe('forbidden')

    const missingObject = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ objectLivesIn: OTHER_WS }),
    )
    expect(missingObject.ok).toBe(false)

    // Soft-deleted records must never satisfy the grant.
    const deleted = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ objectState: 'denied' }),
    )
    expect(deleted.ok).toBe(false)
    if (!deleted.ok) expect(deleted.code).toBe('forbidden')
  })

  it('forces read-only scopes for archived or locked objects even for writers', async () => {
    for (const state of ['read_only'] as const) {
      const result = await resolveRoomAccess(
        new Headers(),
        ROOM,
        makeDeps({ membershipRole: 'scientist', objectState: state }),
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.objectState).toBe('read_only')
        expect(result.permissions.permissions).toContain('comments:read')
        expect(result.permissions.permissions).not.toContain('comments:write')
        expect(result.permissions.permissions).not.toContain('room:write')
      }
    }
  })

  it('keeps writable objects at full writer scopes', async () => {
    const result = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ membershipRole: 'scientist', objectState: 'writable' }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.objectState).toBe('writable')
      expect(result.permissions.permissions).toContain('comments:write')
    }
  })

  it('never elevates a viewer on a writable object above read-only', async () => {
    const result = await resolveRoomAccess(
      new Headers(),
      ROOM,
      makeDeps({ membershipRole: 'viewer', objectState: 'writable' }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.permissions.permissions).toContain('comments:read')
      expect(result.permissions.permissions).not.toContain('comments:write')
    }
  })

  it('rejects unauthenticated sessions and malformed rooms', async () => {
    const deps = makeDeps({})
    const anonHeaders = new Headers()
    const anon = await resolveRoomAccess(anonHeaders, ROOM, {
      ...deps,
      getSession: async () => null,
    })
    expect(anon.ok).toBe(false)
    if (!anon.ok) expect(anon.status).toBe(401)

    for (const room of [
      undefined,
      42,
      'record:abc',
      `workspace:${WS}:record:nope`,
    ]) {
      const bad = await resolveRoomAccess(new Headers(), room, deps)
      expect(bad.ok).toBe(false)
    }
  })
})
