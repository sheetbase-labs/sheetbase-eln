/**
 * The service-credential rows are shared workspace secrets, so revoking or
 * rotating one is a deliberate act: the row buttons only open the shared
 * confirmation, and the callback fires from its action. The route surfaces a
 * failed write (src/routes/settings/api.tsx:123-127).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CreatedCredentialWire,
  CredentialWire,
} from '#/lib/api-credential-admin'

import { SettingsServiceCredentials } from './settings-service-credentials'

// The reveal panel copies through the shared Secret, so the toast is the
// confirmation the panel never gave before.
const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/components/v3/ui/sonner', () => ({ toast: sonner.toast }))

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  sonner.toast.mockClear()
  sonner.toast.error.mockClear()
})

function renderPanel({
  revealed = null,
}: { revealed?: CreatedCredentialWire | null } = {}) {
  const onRevoke = vi.fn()
  const onRotate = vi.fn()
  const onCreate = vi.fn()
  render(
    <SettingsServiceCredentials
      tokens={[CREDENTIAL]}
      revealed={revealed}
      onCreate={onCreate}
      onRevoke={onRevoke}
      onRotate={onRotate}
      onDismissRevealed={vi.fn()}
    />,
  )
  return { onRevoke, onRotate, onCreate }
}

const REVEALED: CreatedCredentialWire = {
  id: 'cred-2',
  secret: 'sb_svc_abcdef',
  displayPrefix: 'sb_svc_ab12',
  name: 'Nightly backup',
  scopes: ['projects:read'],
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

  it('requires an explicit scope instead of pre-granting projects:read', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderPanel()

    const create = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Create credential',
    })
    const readScope = screen.getByRole('checkbox', { name: 'projects:read' })
    expect(readScope.getAttribute('aria-checked')).toBe('false')

    await user.type(
      screen.getByPlaceholderText('Nightly import'),
      'Nightly import',
    )
    expect(create.disabled).toBe(true)

    await user.click(readScope)
    expect(readScope.getAttribute('aria-checked')).toBe('true')
    expect(create.disabled).toBe(false)
    await user.click(create)
    expect(onCreate).toHaveBeenCalledWith(
      'Nightly import',
      ['projects:read'],
      null,
    )
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

  it('confirms the copy when the clipboard takes the credential', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    renderPanel({ revealed: REVEALED })

    await user.click(screen.getByRole('button', { name: 'Copy credential' }))

    expect(writeText).toHaveBeenCalledWith(REVEALED.secret)
    expect(sonner.toast).toHaveBeenCalledWith('Credential copied')
    expect(sonner.toast.error).not.toHaveBeenCalled()
  })

  it('states a refused copy instead of confirming one', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    )
    renderPanel({ revealed: REVEALED })

    await user.click(screen.getByRole('button', { name: 'Copy credential' }))

    expect(sonner.toast.error).toHaveBeenCalled()
    expect(sonner.toast).not.toHaveBeenCalled()
  })
})
