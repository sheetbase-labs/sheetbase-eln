import { describe, expect, it } from 'vitest'

import { browserTitle, unreadFromShellCount } from './browser-title'

describe('browserTitle', () => {
  it('names the page and the app', () => {
    expect(browserTitle({ title: 'Resin screen' })).toBe(
      'Resin screen · Sheetbase',
    )
  })

  it('puts a record’s identifier first so open tabs differ', () => {
    expect(
      browserTitle({ identifier: 'EXP-3101', title: 'Resin screen' }),
    ).toBe('EXP-3101 Resin screen · Sheetbase')
  })

  it('does not repeat an identifier the title already starts with', () => {
    expect(
      browserTitle({ identifier: 'EXP-3101', title: 'EXP-3101 Resin screen' }),
    ).toBe('EXP-3101 Resin screen · Sheetbase')
  })

  it('falls back to the app name alone', () => {
    expect(browserTitle({})).toBe('Sheetbase')
    expect(browserTitle({ title: '  ' })).toBe('Sheetbase')
  })

  it('puts the unread count in front while something waits', () => {
    expect(browserTitle({ title: 'Inbox', unread: 26 })).toBe(
      '(26) Inbox · Sheetbase',
    )
    expect(browserTitle({ title: 'Inbox', unread: 0 })).toBe(
      'Inbox · Sheetbase',
    )
    expect(browserTitle({ title: 'Inbox', unread: 250 })).toBe(
      '(99+) Inbox · Sheetbase',
    )
  })
})

describe('unreadFromShellCount', () => {
  it('reads the shell’s text count', () => {
    expect(unreadFromShellCount('12')).toBe(12)
    expect(unreadFromShellCount('99+')).toBe(99)
    expect(unreadFromShellCount(undefined)).toBe(0)
    expect(unreadFromShellCount(null)).toBe(0)
    expect(unreadFromShellCount('—')).toBe(0)
  })
})
