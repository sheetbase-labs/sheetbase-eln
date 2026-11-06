import { describe, expect, it } from 'vitest'

import { resolveSettingsAccess } from '#/lib/settings-access'

import {
  settingsHomePath,
  settingsNavForRole,
  settingsPlaceForPath,
} from './settings-nav'

const ADMIN_ONLY = [
  'General',
  'Members and roles',
  'Project access',
  'Clients',
  'Audit and retention',
  'Diagnostics',
  'Usage',
]
const GOVERNED_ONLY = ['Integrations']
const LAB = [
  'Models',
  'Storage locations',
  'Label templates',
  'Sample release',
  'Sample workflows',
  'Instruments and parsers',
  'Retention and holds',
  'Scheduled reports',
  'Sidebar',
]

const labels = (
  role: string | null | undefined,
  place: 'lab' | 'workspace' | 'account',
) => settingsNavForRole(role)[place].map((i) => i.label)

describe('SHELL-01.2 settings navigation', () => {
  it('shows ordinary members only their account', () => {
    for (const role of [
      'member',
      'scientist',
      'analyst',
      'reviewer',
      'viewer',
      'client_viewer',
    ]) {
      expect(labels(role, 'workspace')).toEqual([])
      expect(labels(role, 'lab')).toEqual([])
      expect(labels(role, 'account')).toContain('API and SDK')
    }
    expect(labels(null, 'workspace')).toEqual([])
    expect(labels(null, 'lab')).toEqual([])
  })

  it('shows workspace administration and lab setup to owners and admins', () => {
    for (const role of ['owner', 'admin']) {
      const workspace = labels(role, 'workspace')
      for (const restricted of [
        ...ADMIN_ONLY,
        ...GOVERNED_ONLY,
        'Electronic signatures',
      ]) {
        expect(workspace).toContain(restricted)
      }
      expect(labels(role, 'lab')).toEqual(LAB)
    }
  })

  it('gives a steward lab setup and integrations without workspace administration', () => {
    expect(labels('steward', 'lab')).toEqual(
      LAB.filter(
        (l) =>
          l !== 'Retention and holds' &&
          l !== 'Scheduled reports' &&
          l !== 'Sidebar',
      ),
    )
    expect(labels('steward', 'workspace')).toEqual(['Integrations'])
  })

  it('offers the personal account sections, and My signature only to people who sign', () => {
    for (const role of ['owner', 'admin', 'steward', 'member', 'reviewer']) {
      expect(labels(role, 'account')).toEqual([
        'Profile',
        'My signature',
        'Notifications',
        'API and SDK',
      ])
    }
    for (const role of ['viewer', 'client_viewer', null]) {
      expect(labels(role, 'account')).toEqual([
        'Profile',
        'Notifications',
        'API and SDK',
      ])
    }
  })

  it('names which place a settings path is in', () => {
    expect(settingsPlaceForPath('/settings/lab/labels')).toBe('lab')
    expect(settingsPlaceForPath('/settings/workspace')).toBe('workspace')
    expect(settingsPlaceForPath('/settings/workspace/roles')).toBe('workspace')
    expect(settingsPlaceForPath('/settings/account/api')).toBe('account')
    expect(settingsPlaceForPath('/settings/lab/sidebar')).toBe('lab')
    expect(settingsPlaceForPath('/models/m1/fields')).toBe('lab')
  })

  it('never opens Settings on Models, which has its own page', () => {
    const access = {
      ...resolveSettingsAccess('steward'),
      integrations: 'none',
    } as const
    expect(settingsHomePath('steward', access)).toBe('/settings/lab/storage')
  })

  it('opens Settings on General for admins, lab setup for stewards and the profile for everyone else', () => {
    expect(settingsHomePath('owner')).toBe('/settings/workspace/members')
    expect(settingsHomePath('admin')).toBe('/settings/workspace/members')
    expect(settingsHomePath('steward')).toBe('/settings/workspace/integrations')
    for (const role of [
      'scientist',
      'member',
      'viewer',
      'client_viewer',
      null,
    ]) {
      expect(settingsHomePath(role)).toBe('/settings/account/profile')
    }
  })

  it('follows the workspace access choices rather than the role alone', () => {
    const access = {
      ...resolveSettingsAccess('reviewer'),
      audit: 'view',
      usage: 'manage',
    } as const
    const workspace = settingsNavForRole('reviewer', access).workspace.map(
      (i) => i.label,
    )
    expect(workspace).toContain('Audit and retention')
    expect(workspace).toContain('Usage')
    expect(workspace).not.toContain('Members and roles')
  })

  it('lets a workspace give any role the storage sections', () => {
    const access = {
      ...resolveSettingsAccess('scientist'),
      storage: 'view',
    } as const
    expect(
      settingsNavForRole('scientist', access).lab.map((i) => i.label),
    ).toContain('Storage locations')
    expect(labels('scientist', 'lab')).not.toContain('Storage locations')
    const revoked = {
      ...resolveSettingsAccess('steward'),
      storage: 'none',
    } as const
    expect(
      settingsNavForRole('steward', revoked).lab.map((i) => i.label),
    ).toEqual(['Models', 'Instruments and parsers'])
  })
})
