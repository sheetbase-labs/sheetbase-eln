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
  it('lets writers edit together', () => {
    for (const role of WRITER_ROLE) {
      expect(roomPermissionsForRole(role)).toEqual(['room:write'])
    }
  })

  it('keeps viewers read-only consistent with GOV-01', () => {
    const scopes = roomPermissionsForRole('viewer')
    expect(scopes).toEqual(['room:read'])
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
      expect(result.permissions).toEqual(['room:read'])
    }
  })
})
