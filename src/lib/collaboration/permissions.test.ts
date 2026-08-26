import { describe, expect, it } from 'vitest'

import {
  accessForMembership,
  canCommentInRoom,
  roomPermissionsForRole,
} from './permissions'

const WRITER_ROLE = [
  'owner',
  'admin',
  'member',
  'steward',
  'scientist',
  'analyst',
  'reviewer',
] as const

describe('collaboration permission mapping', () => {
  it('grants writers presence + comment write but no storage or feeds', () => {
    for (const role of WRITER_ROLE) {
      const scopes = roomPermissionsForRole(role)
      expect(scopes).toContain('room:write')
      expect(scopes).toContain('comments:write')
      expect(scopes).toContain('storage:none')
      expect(scopes).toContain('feeds:none')
    }
  })

  it('keeps viewers read-only consistent with GOV-01', () => {
    const scopes = roomPermissionsForRole('viewer')
    expect(scopes).toContain('room:read')
    expect(scopes).toContain('comments:read')
    expect(scopes).toContain('storage:none')
    expect(scopes).toContain('feeds:none')
    expect(scopes).not.toContain('room:write')
    expect(scopes).not.toContain('comments:write')
    expect(canCommentInRoom('viewer')).toBe(false)
  })

  it('denies unknown roles outright', () => {
    expect(roomPermissionsForRole('ghost')).toEqual([])
  })

  it('denies non-members and suspended members', () => {
    expect(accessForMembership(null)).toEqual({
      ok: false,
      reason: 'no_membership',
    })
    const suspended = {
      role: 'scientist',
      suspendedAt: new Date('2026-01-01T00:00:00Z'),
    }
    expect(accessForMembership(suspended)).toEqual({
      ok: false,
      reason: 'suspended',
    })
  })

  it('maps an active membership to scoped access', () => {
    const result = accessForMembership({ role: 'viewer', suspendedAt: null })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.role).toBe('viewer')
      expect(result.permissions).toContain('comments:read')
    }
  })
})
