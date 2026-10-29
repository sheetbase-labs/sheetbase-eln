import { describe, expect, it } from 'vitest'

import { CAPABILITIES, capabilitiesForRole, hasCapability } from './capability'
import type { WorkspaceRole } from './workspace-admin'

const UNUSED_MEMBER_ROLES: WorkspaceRole[] = [
  'scientist',
  'analyst',
  'reviewer',
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
    for (const role of ['member', ...UNUSED_MEMBER_ROLES] as WorkspaceRole[]) {
      expect(hasCapability(role, 'schema.edit')).toBe(false)
      expect(hasCapability(role, 'schema.publish')).toBe(false)
      expect(hasCapability(role, 'record.link')).toBe(true)
      expect(hasCapability(role, 'instance.upgrade')).toBe(true)
    }
  })

  it('makes viewer read-only without schema or admin authority', () => {
    expect(hasCapability('viewer', 'workspace.admin')).toBe(false)
    expect(hasCapability('viewer', 'schema.edit')).toBe(false)
    expect(hasCapability('viewer', 'schema.publish')).toBe(false)
    expect(hasCapability('viewer', 'record.link')).toBe(false)
    expect(hasCapability('viewer', 'record.create')).toBe(false)
    expect(hasCapability('viewer', 'instance.upgrade')).toBe(false)
    expect(capabilitiesForRole('viewer')).toEqual([])
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
      'integrations.manage',
      'pipelines.manage',
      'extensions.manage',
      'instrument.manage',
      'calibration.record',
    ])
  })

  it('keeps instrument administration to governed roles and calibration to the people who run instruments', () => {
    for (const role of ['owner', 'admin', 'steward']) {
      expect(hasCapability(role, 'instrument.manage')).toBe(true)
    }
    for (const role of [
      'scientist',
      'member',
      'analyst',
      'reviewer',
      'viewer',
    ]) {
      expect(hasCapability(role, 'instrument.manage')).toBe(false)
    }
    for (const role of ['owner', 'admin', 'steward', 'scientist', 'member']) {
      expect(hasCapability(role, 'calibration.record')).toBe(true)
    }
    for (const role of ['analyst', 'reviewer', 'viewer']) {
      expect(hasCapability(role, 'calibration.record')).toBe(false)
    }
  })

  it('grants integrations.manage to governed roles only', () => {
    expect(hasCapability('owner', 'integrations.manage')).toBe(true)
    expect(hasCapability('admin', 'integrations.manage')).toBe(true)
    expect(hasCapability('steward', 'integrations.manage')).toBe(true)
    expect(hasCapability('member', 'integrations.manage')).toBe(false)
    expect(hasCapability('scientist', 'integrations.manage')).toBe(false)
    expect(hasCapability('viewer', 'integrations.manage')).toBe(false)
  })

  it('grants extensions.manage to governed roles only', () => {
    expect(hasCapability('owner', 'extensions.manage')).toBe(true)
    expect(hasCapability('admin', 'extensions.manage')).toBe(true)
    expect(hasCapability('steward', 'extensions.manage')).toBe(true)
    expect(hasCapability('member', 'extensions.manage')).toBe(false)
    expect(hasCapability('scientist', 'extensions.manage')).toBe(false)
    expect(hasCapability('viewer', 'extensions.manage')).toBe(false)
  })

  it('grants pipelines.manage to governed roles only', () => {
    expect(hasCapability('owner', 'pipelines.manage')).toBe(true)
    expect(hasCapability('admin', 'pipelines.manage')).toBe(true)
    expect(hasCapability('steward', 'pipelines.manage')).toBe(true)
    expect(hasCapability('member', 'pipelines.manage')).toBe(false)
    expect(hasCapability('scientist', 'pipelines.manage')).toBe(false)
    expect(hasCapability('analyst', 'pipelines.manage')).toBe(false)
    expect(hasCapability('reviewer', 'pipelines.manage')).toBe(false)
    expect(hasCapability('viewer', 'pipelines.manage')).toBe(false)
  })
})
