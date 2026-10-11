import { describe, expect, it } from 'vitest'

import { WORKSPACE_ADMIN_ROLES, filterNavForRole } from '#/lib/nav-visibility'
import { isHomeSection, primaryNav, recordNav } from './nav'
import type { NavItem } from './nav'

const MEMBER_ROLES = [
  'owner',
  'admin',
  'steward',
  'member',
  'scientist',
  'analyst',
  'reviewer',
  'viewer',
]

describe('Home section selection', () => {
  it.each(['/', '/help', '/help/records', '/help/shortcuts'])(
    'includes %s',
    (pathname) => expect(isHomeSection(pathname)).toBe(true),
  )
  it.each(['/helpful', '/projects', '/inbox', '/projects/help'])(
    'does not include %s',
    (pathname) => expect(isHomeSection(pathname)).toBe(false),
  )
})

describe('SHELL-01.2 main navigation', () => {
  it('keeps everyday scientific navigation visible to every member role', () => {
    const expected = [...primaryNav, ...recordNav].map((i) => i.label)
    for (const role of MEMBER_ROLES) {
      const visible = [
        ...filterNavForRole(primaryNav, role),
        ...filterNavForRole(recordNav, role),
      ].map((i) => i.label)
      expect(visible).toEqual(expected)
    }
  })

  it('keeps the instrument registry in the main navigation', () => {
    // An instrument is a bench object with an identifier, qualification,
    // calibration and bookings, so its registry is reachable from the main nav
    // for every member — not only from the role-gated Settings tab that owns
    // parser and connection configuration.
    expect(recordNav.map((item) => item.link.to)).toContain('/instruments')
    expect(
      filterNavForRole(recordNav, 'viewer').map((item) => item.label),
    ).toContain('Instruments')
  })

  it('omits a restricted main-nav item from a viewer and keeps it for an admin', () => {
    const restricted: NavItem = {
      label: 'Workspace admin',
      icon: 'settings',
      link: { to: '/settings' },
      roles: WORKSPACE_ADMIN_ROLES,
    }
    const items = [...primaryNav, restricted]
    expect(filterNavForRole(items, 'viewer').map((i) => i.label)).not.toContain(
      'Workspace admin',
    )
    expect(filterNavForRole(items, 'admin').map((i) => i.label)).toContain(
      'Workspace admin',
    )
  })
})
