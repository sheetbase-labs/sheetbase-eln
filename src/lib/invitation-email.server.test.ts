import { describe, expect, it } from 'vitest'

import { composeInvitationEmail } from './invitation-email.server'

describe('composeInvitationEmail', () => {
  const base = {
    origin: 'https://eln.lab.example',
    token: 'tok en/1',
    email: 'new.person@lab.example',
    role: 'scientist',
    workspaceName: 'Cell Biology',
    inviterName: 'Dana Whyte',
  }

  it('addresses the invitee and carries the one-time accept link', () => {
    const message = composeInvitationEmail(base)
    expect(message.to).toBe('new.person@lab.example')
    expect(message.subject).toBe(
      'Dana Whyte invited you to Cell Biology on Sheetbase',
    )
    expect(message.body).toContain(
      'https://eln.lab.example/accept-invitation?token=tok%20en%2F1',
    )
    expect(message.body).toContain('Cell Biology')
    expect(message.body).toContain('7 days')
  })

  it('names the role the way the people list does', () => {
    expect(composeInvitationEmail({ ...base, role: 'viewer' }).body).toMatch(
      /role will be viewer/i,
    )
  })

  it('does not leave a blank where an unknown inviter would be', () => {
    const message = composeInvitationEmail({ ...base, inviterName: null })
    expect(message.subject).toBe(
      'A colleague invited you to Cell Biology on Sheetbase',
    )
  })
})
