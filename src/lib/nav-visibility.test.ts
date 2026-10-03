import { describe, expect, it } from 'vitest'

import {
  WORKSPACE_ADMIN_ROLES,
  canSeeNavItem,
  filterNavForRole,
} from './nav-visibility'
import type { NavVisibility } from './nav-visibility'

describe('canSeeNavItem', () => {
  it('shows an item with no restriction to every role, including none', () => {
    const item: NavVisibility = {}
    for (const role of [null, undefined, 'owner', 'member', 'viewer']) {
      expect(canSeeNavItem(item, { role })).toBe(true)
    }
  })

  it('restricts a workspace-admin item to owners and admins', () => {
    const item: NavVisibility = { roles: WORKSPACE_ADMIN_ROLES }
    expect(canSeeNavItem(item, { role: 'owner' })).toBe(true)
    expect(canSeeNavItem(item, { role: 'admin' })).toBe(true)
    expect(canSeeNavItem(item, { role: 'steward' })).toBe(false)
    expect(canSeeNavItem(item, { role: 'member' })).toBe(false)
    expect(canSeeNavItem(item, { role: 'viewer' })).toBe(false)
    expect(canSeeNavItem(item, { role: null })).toBe(false)
  })

  it('gates a capability item on the capability vocabulary', () => {
    const item: NavVisibility = { capability: 'integrations.manage' }
    // GOVERNED_SCHEMA_ROLES: owner, admin, steward.
    expect(canSeeNavItem(item, { role: 'owner' })).toBe(true)
    expect(canSeeNavItem(item, { role: 'admin' })).toBe(true)
    expect(canSeeNavItem(item, { role: 'steward' })).toBe(true)
    expect(canSeeNavItem(item, { role: 'member' })).toBe(false)
    expect(canSeeNavItem(item, { role: 'viewer' })).toBe(false)
    expect(canSeeNavItem(item, { role: null })).toBe(false)
  })

  it('requires both role and capability when both are present', () => {
    const item: NavVisibility = {
      roles: WORKSPACE_ADMIN_ROLES,
      capability: 'integrations.manage',
    }
    expect(canSeeNavItem(item, { role: 'owner' })).toBe(true)
    // Steward has the capability but not the role.
    expect(canSeeNavItem(item, { role: 'steward' })).toBe(false)
  })
})

describe('filterNavForRole', () => {
  const items: NavVisibility[] = [
    {},
    { roles: WORKSPACE_ADMIN_ROLES },
    { capability: 'integrations.manage' },
  ]

  it('drops hidden items and preserves the remaining order', () => {
    expect(filterNavForRole(items, 'member')).toEqual([{}])
    expect(filterNavForRole(items, 'steward')).toEqual([
      {},
      { capability: 'integrations.manage' },
    ])
    expect(filterNavForRole(items, 'owner')).toEqual(items)
  })
})
