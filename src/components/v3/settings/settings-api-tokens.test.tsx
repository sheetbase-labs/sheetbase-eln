/**
 * Revoking a personal token is permanent and rotating one invalidates the live
 * secret, so the row buttons only open the shared confirmation and the
 * callback fires from its action. The route surfaces a failed write
 * (src/routes/settings/api.tsx:123-127).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PersonalTokenWire } from '#/lib/personal-api-tokens'

import { SettingsApiTokens } from './settings-api-tokens'

const TOKEN: PersonalTokenWire = {
  id: 'token-1',
  workspaceId: 'ws',
  displayPrefix: 'sb_pat_ab12',
  name: 'Local Jupyter',
  scopes: ['projects:read'],
  createdAt: '2026-09-01T09:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  createdByUserId: 'user-1',
}

afterEach(cleanup)

function renderPanel() {
  const onRevoke = vi.fn()
  const onRotate = vi.fn()
  render(
    <SettingsApiTokens
      tokens={[TOKEN]}
      revealed={null}
      onCreate={vi.fn()}
      onRevoke={onRevoke}
      onRotate={onRotate}
      onDismissRevealed={vi.fn()}
    />,
  )
  return { onRevoke, onRotate }
}

describe('SettingsApiTokens', () => {
  it('confirms a revoke before it fires, and revokes only from the confirmation', async () => {
    const user = userEvent.setup()
    const { onRevoke } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(onRevoke).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: 'Revoke token' }),
    )
    expect(onRevoke).toHaveBeenCalledWith(TOKEN.id)
  })

  it('confirms a rotate before it fires, and rotates only from the confirmation', async () => {
    const user = userEvent.setup()
    const { onRotate } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Rotate' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(onRotate).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: 'Rotate token' }),
    )
    expect(onRotate).toHaveBeenCalledWith(TOKEN.id)
  })
})
