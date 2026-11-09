import { describe, expect, it } from 'vitest'

import { WORKSPACE_ADMIN_ROLES, filterNavForRole } from '#/lib/nav-visibility'
import {
  canHideNavPage,
  isHomePage,
  navGroups,
  primaryNav,
  recordNav,
  visibleNavGroups,
} from './nav'
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

describe('Home selection', () => {
  it('is selected on the Home page', () => expect(isHomePage('/')).toBe(true))
  it.each([
    '/help',
    '/help/records',
    '/help/shortcuts',
    '/helpful',
    '/projects',
    '/inbox',
    '/projects/help',
  ])('does not include %s', (pathname) =>
    expect(isHomePage(pathname)).toBe(false),
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
      key: 'workspace-admin',
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

describe('sidebar groups', () => {
  it('lists every grouped page once, with a unique key, and no Models', () => {
    const keys = recordNav.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain('models')
    expect(navGroups.map((g) => g.key)).toEqual([
      'work',
      'lab',
      'data',
      'methods',
    ])
  })

  it('never hides Projects or Experiments, or a page it does not know', () => {
    expect(canHideNavPage('projects')).toBe(false)
    expect(canHideNavPage('experiments')).toBe(false)
    expect(canHideNavPage('home')).toBe(false)
    expect(canHideNavPage('nonsense')).toBe(false)
    expect(canHideNavPage('shipments')).toBe(true)
  })

  it('drops hidden pages and any group left empty', () => {
    const groups = visibleNavGroups(navGroups, [
      'protocols',
      'templates',
      'projects',
    ])

    expect(groups.map((g) => g.key)).toEqual(['work', 'lab', 'data'])
    expect(groups[0].items.map((i) => i.key)).toContain('projects')
  })
})
