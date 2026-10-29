import { describe, expect, it } from 'vitest'

import {
  canManageSettings,
  canOpenSettings,
  defaultSettingsLevel,
  resolveSettingsAccess,
  settingsLevelFor,
  workPermissionAllowed,
} from './settings-access'

describe('settings access', () => {
  it('defaults to how the workspace behaved before it was configurable', () => {
    expect(defaultSettingsLevel('general', 'admin')).toBe('manage')
    expect(defaultSettingsLevel('general', 'steward')).toBe('none')
    for (const area of ['instruments', 'integrations', 'storage'] as const) {
      expect(defaultSettingsLevel(area, 'steward')).toBe('manage')
    }
    expect(defaultSettingsLevel('audit', 'scientist')).toBe('none')
  })

  it('lets a stored choice replace the default, and never locks out the owner', () => {
    const rows = [
      { area: 'audit', role: 'reviewer', level: 'view' },
      { area: 'general', role: 'admin', level: 'none' },
      { area: 'general', role: 'owner', level: 'none' },
    ]
    expect(settingsLevelFor('audit', 'reviewer', rows)).toBe('view')
    expect(settingsLevelFor('general', 'admin', rows)).toBe('none')
    expect(settingsLevelFor('general', 'owner', rows)).toBe('manage')
  })

  it('ignores an unknown stored level', () => {
    expect(
      settingsLevelFor('usage', 'admin', [
        { area: 'usage', role: 'admin', level: 'everything' },
      ]),
    ).toBe('manage')
  })

  it('never opens settings to a client viewer', () => {
    const access = resolveSettingsAccess('client_viewer')
    expect(Object.values(access).every((level) => level === 'none')).toBe(true)
  })

  it('reads the server-resolved map from a workspace context', () => {
    const workspace = {
      role: 'viewer',
      settingsAccess: { ...resolveSettingsAccess('viewer'), audit: 'view' },
    } as const
    expect(canOpenSettings(workspace, 'audit')).toBe(true)
    expect(canManageSettings(workspace, 'audit')).toBe(false)
    expect(canOpenSettings({ role: 'viewer' }, 'audit')).toBe(false)
  })
})

describe('work permissions', () => {
  it('lets every role that could write before keep writing, until the workspace says otherwise', () => {
    for (const role of [
      'admin',
      'steward',
      'scientist',
      'member',
      'analyst',
      'reviewer',
    ]) {
      expect(workPermissionAllowed('samples', role)).toBe(true)
    }
    expect(workPermissionAllowed('samples', 'viewer')).toBe(false)
    expect(workPermissionAllowed('samples', 'client_viewer')).toBe(false)
  })

  it('follows a stored choice for one kind of work, and never takes it from the workspace admin', () => {
    const rows = [
      { area: 'work_samples', role: 'scientist', level: 'none' },
      { area: 'work_samples', role: 'owner', level: 'none' },
      { area: 'work_comments', role: 'viewer', level: 'manage' },
    ]
    expect(workPermissionAllowed('samples', 'scientist', rows)).toBe(false)
    expect(workPermissionAllowed('datasets', 'scientist', rows)).toBe(true)
    expect(workPermissionAllowed('samples', 'owner', rows)).toBe(true)
    expect(workPermissionAllowed('comments', 'viewer', rows)).toBe(true)
  })
})
