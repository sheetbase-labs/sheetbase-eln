import { describe, expect, it } from 'vitest'

import { settingsHomePath, settingsNavForRole } from './settings-nav'

const ADMIN_ONLY = [
  'General',
  'Members and roles',
  'Project access',
  'Clients',
  'Audit and retention',
  'Diagnostics',
  'Usage',
]
const GOVERNED_ONLY = ['Instruments and parsers', 'Integrations']

const workspaceLabels = (role: string | null | undefined) =>
  settingsNavForRole(role).workspace.map((i) => i.label)

describe('SHELL-01.2 settings navigation', () => {
  it('omits workspace administration from ordinary members', () => {
    for (const role of [
      'member',
      'scientist',
      'analyst',
      'reviewer',
      'viewer',
      'client_viewer',
    ]) {
      const labels = workspaceLabels(role)
      for (const restricted of [...ADMIN_ONLY, ...GOVERNED_ONLY]) {
        expect(labels).not.toContain(restricted)
      }
      expect(labels).toEqual(
        ['viewer', 'client_viewer'].includes(role)
          ? ['API and SDK']
          : ['Electronic signatures', 'API and SDK'],
      )
    }
  })

  it('omits workspace administration from a caller with no role', () => {
    expect(workspaceLabels(null)).toEqual(['API and SDK'])
  })

  it('shows workspace administration to owners and admins', () => {
    for (const role of ['owner', 'admin']) {
      const labels = workspaceLabels(role)
      for (const restricted of [
        ...ADMIN_ONLY,
        ...GOVERNED_ONLY,
        'Electronic signatures',
      ]) {
        expect(labels).toContain(restricted)
      }
      expect(labels).toContain('API and SDK')
    }
  })

  it('shows integration surfaces to a steward without workspace administration', () => {
    const labels = workspaceLabels('steward')
    for (const governed of GOVERNED_ONLY) expect(labels).toContain(governed)
    for (const admin of ADMIN_ONLY) expect(labels).not.toContain(admin)
    expect(labels).toContain('API and SDK')
    expect(labels).toContain('Electronic signatures')
  })

  it('always offers the personal account sections', () => {
    for (const role of [
      'owner',
      'admin',
      'steward',
      'member',
      'viewer',
      null,
    ]) {
      expect(settingsNavForRole(role).account.map((i) => i.label)).toEqual([
        'Profile',
        'Notifications',
      ])
    }
  })

  it('opens Settings on General for admins and on the profile for everyone else', () => {
    expect(settingsHomePath('owner')).toBe('/settings')
    expect(settingsHomePath('admin')).toBe('/settings')
    for (const role of [
      'scientist',
      'member',
      'viewer',
      'client_viewer',
      null,
    ]) {
      expect(settingsHomePath(role)).toBe('/settings/profile')
    }
  })
})
