import { describe, expect, it } from 'vitest'

import { clientPortalRedirect } from './client-portal-only'

describe('clientPortalRedirect', () => {
  it('sends a client away from the internal app', () => {
    expect(clientPortalRedirect('client_viewer', '/experiments')).toEqual({
      to: '/client-portal',
    })
    expect(clientPortalRedirect('client_viewer', '/')).toEqual({
      to: '/client-portal',
    })
    expect(clientPortalRedirect('client_viewer', '/settings/members')).toEqual({
      to: '/client-portal',
    })
  })

  it('leaves the portal and sign-in alone', () => {
    expect(clientPortalRedirect('client_viewer', '/client-portal')).toBeNull()
    expect(clientPortalRedirect('client_viewer', '/sign-in')).toBeNull()
    expect(
      clientPortalRedirect('client_viewer', '/accept-invitation'),
    ).toBeNull()
  })

  it('does not touch the team', () => {
    expect(clientPortalRedirect('viewer', '/experiments')).toBeNull()
    expect(clientPortalRedirect('member', '/')).toBeNull()
    expect(clientPortalRedirect(null, '/experiments')).toBeNull()
  })
})
