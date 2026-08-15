import { describe, expect, it } from 'vitest'

import { CAPABILITIES, capabilitiesForRole, hasCapability } from './capability'
import type { WorkspaceRole } from './workspace-admin'

const UNUSED_ROLES: WorkspaceRole[] = [
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
]

describe('CORE-05 capability mapping', () => {
  it('gives stewards governed schema authority without workspace administration', () => {
    expect(hasCapability('steward', 'schema.edit')).toBe(true)
    expect(hasCapability('steward', 'schema.publish')).toBe(true)
    expect(hasCapability('steward', 'schema.retire')).toBe(true)
    expect(hasCapability('steward', 'workspace.admin')).toBe(false)
    expect(hasCapability('steward', 'record.create')).toBe(true)
  })

  it('keeps workspace administration owner-only', () => {
    expect(hasCapability('owner', 'workspace.admin')).toBe(true)
    expect(hasCapability('admin', 'workspace.admin')).toBe(false)
    expect(hasCapability('member', 'workspace.admin')).toBe(false)
  })

  it('does not grant governed schema authority to ordinary or unused member roles', () => {
    for (const role of ['member', ...UNUSED_ROLES] as WorkspaceRole[]) {
      expect(hasCapability(role, 'schema.edit')).toBe(false)
      expect(hasCapability(role, 'schema.publish')).toBe(false)
      expect(hasCapability(role, 'record.link')).toBe(true)
      expect(hasCapability(role, 'instance.upgrade')).toBe(true)
    }
  })

  it('lists the same vocabulary the server enforces', () => {
    expect(capabilitiesForRole('owner')).toEqual([...CAPABILITIES])
    expect(capabilitiesForRole('steward')).toEqual([
      'schema.edit',
      'schema.publish',
      'schema.retire',
      'record.link',
      'record.create',
      'instance.upgrade',
    ])
  })
})
