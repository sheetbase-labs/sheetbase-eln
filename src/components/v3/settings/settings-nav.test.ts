import { describe, expect, it } from 'vitest'

import { resolveSettingsAccess } from '#/lib/settings-access'

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
const GOVERNED_ONLY = [
  'Instruments and parsers',
  'Integrations',
  'Storage and labels',
]

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
      expect(labels).toEqual(['API and SDK'])
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
    expect(labels).not.toContain('Electronic signatures')
  })

  it('offers the personal account sections, and My signature only to people who sign', () => {
    for (const role of ['owner', 'admin', 'steward', 'member', 'reviewer']) {
      expect(settingsNavForRole(role).account.map((i) => i.label)).toEqual([
        'Profile',
        'My signature',
        'Notifications',
      ])
    }
    for (const role of ['viewer', 'client_viewer', null]) {
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

  it('follows the workspace access choices rather than the role alone', () => {
    const access = {
      ...resolveSettingsAccess('reviewer'),
      audit: 'view',
      usage: 'manage',
    } as const
    const labels = settingsNavForRole('reviewer', access).workspace.map(
      (i) => i.label,
    )
    expect(labels).toContain('Audit and retention')
    expect(labels).toContain('Usage')
    expect(labels).not.toContain('Members and roles')
    expect(settingsHomePath('reviewer', { ...access, general: 'view' })).toBe(
      '/settings',
    )
  })

  it('lets a workspace give any role Storage and labels', () => {
    const access = {
      ...resolveSettingsAccess('scientist'),
      storage: 'view',
    } as const
    expect(
      settingsNavForRole('scientist', access).workspace.map((i) => i.label),
    ).toContain('Storage and labels')
    expect(workspaceLabels('scientist')).not.toContain('Storage and labels')
    const revoked = {
      ...resolveSettingsAccess('steward'),
      storage: 'none',
    } as const
    expect(
      settingsNavForRole('steward', revoked).workspace.map((i) => i.label),
    ).not.toContain('Storage and labels')
  })
})
