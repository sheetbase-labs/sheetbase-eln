/**
 * The service-credential rows are shared workspace secrets, so revoking or
 * rotating one is a deliberate act: the row buttons only open the shared
 * confirmation, and the callback fires from its action. The route surfaces a
 * failed write (src/routes/settings/api.tsx:123-127).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CredentialWire } from '#/lib/api-credential-admin'

import { SettingsServiceCredentials } from './settings-service-credentials'

const CREDENTIAL: CredentialWire = {
  id: 'cred-1',
  workspaceId: 'ws',
  kind: 'service',
  displayPrefix: 'sb_svc_ab12',
  name: 'Nightly backup',
  scopes: ['projects:read'],
  createdAt: '2026-09-01T09:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  createdByUserId: 'owner-1',
}

afterEach(cleanup)

function renderPanel() {
  const onRevoke = vi.fn()
  const onRotate = vi.fn()
  render(
    <SettingsServiceCredentials
      tokens={[CREDENTIAL]}
      revealed={null}
      onCreate={vi.fn()}
      onRevoke={onRevoke}
      onRotate={onRotate}
      onDismissRevealed={vi.fn()}
    />,
  )
  return { onRevoke, onRotate }
}

describe('SettingsServiceCredentials', () => {
  it('confirms a revoke before it fires, and revokes only from the confirmation', async () => {
    const user = userEvent.setup()
    const { onRevoke } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(onRevoke).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: 'Revoke credential' }),
    )
    expect(onRevoke).toHaveBeenCalledWith(CREDENTIAL.id)
  })

  it('confirms a rotate before it fires, and rotates only from the confirmation', async () => {
    const user = userEvent.setup()
    const { onRotate } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Rotate' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(onRotate).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: 'Rotate credential' }),
    )
    expect(onRotate).toHaveBeenCalledWith(CREDENTIAL.id)
  })
})
