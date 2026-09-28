import { describe, expect, it } from 'vitest'

import { isWithinQuietHours, nextSendAt } from './email-schedule'
import { renderEmail } from './email-templates'

describe('renderEmail', () => {
  it('builds a subject and body from the event and context', () => {
    const email = renderEmail('review_requested', {
      actorName: 'Priya S.',
      recordIdentifier: 'EXP-0138',
      recordTitle: 'Transfection ratio sweep',
      url: 'https://app.test/records/r1',
    })
    expect(email.subject).toBe('Review requested')
    expect(email.body).toContain('Priya S. — Review requested.')
    expect(email.body).toContain('EXP-0138 · Transfection ratio sweep')
    expect(email.body).toContain('https://app.test/records/r1')
  })
})

describe('quiet hours', () => {
  const quiet = { start: '22:00', end: '07:00' }

  it('detects an overnight window', () => {
    expect(isWithinQuietHours(new Date('2026-09-25T23:30:00'), quiet)).toBe(
      true,
    )
    expect(isWithinQuietHours(new Date('2026-09-25T06:30:00'), quiet)).toBe(
      true,
    )
    expect(isWithinQuietHours(new Date('2026-09-25T12:00:00'), quiet)).toBe(
      false,
    )
  })

  it('holds a non-urgent email until the window ends', () => {
    const now = new Date('2026-09-25T23:30:00')
    const send = nextSendAt(now, quiet, 'material_expiring')
    expect(send.getHours()).toBe(7)
    expect(send.getMinutes()).toBe(0)
    expect(send.getDate()).toBe(26)
  })

  it('always delivers reviews and signature requests', () => {
    const now = new Date('2026-09-25T23:30:00')
    expect(nextSendAt(now, quiet, 'review_requested')).toBe(now)
    expect(nextSendAt(now, quiet, 'signature_requested')).toBe(now)
  })

  it('sends immediately outside the window', () => {
    const now = new Date('2026-09-25T12:00:00')
    expect(nextSendAt(now, quiet, 'material_expiring')).toBe(now)
  })
})
