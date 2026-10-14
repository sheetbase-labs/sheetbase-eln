/**
 * Revoking a personal token is permanent and rotating one invalidates the live
 * secret, so the row buttons only open the shared confirmation and the
 * callback fires from its action. The route surfaces a failed write
 * (src/routes/settings/api.tsx:123-127).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CreatedPersonalTokenWire,
  PersonalTokenWire,
} from '#/lib/personal-api-tokens'

import { SettingsApiTokens } from './settings-api-tokens'

// The reveal panel copies through the shared Secret, so the toast is the
// confirmation the panel never gave before.
const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/components/v3/ui/sonner', () => ({ toast: sonner.toast }))

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  sonner.toast.mockClear()
  sonner.toast.error.mockClear()
})

function renderPanel({
  revealed = null,
}: { revealed?: CreatedPersonalTokenWire | null } = {}) {
  const onCreate = vi.fn()
  const onRevoke = vi.fn()
  const onRotate = vi.fn()
  render(
    <SettingsApiTokens
      tokens={[TOKEN]}
      revealed={revealed}
      onCreate={onCreate}
      onRevoke={onRevoke}
      onRotate={onRotate}
      onDismissRevealed={vi.fn()}
    />,
  )
  return { onCreate, onRevoke, onRotate }
}

const REVEALED: CreatedPersonalTokenWire = {
  id: 'token-2',
  secret: 'sb_pat_abcdef',
  displayPrefix: 'sb_pat_ab12',
  name: 'Local Jupyter',
  scopes: ['projects:read'],
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

  it('requires an explicit scope instead of pre-granting projects:read', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderPanel()

    const create = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Create token',
    })
    const readScope = screen.getByRole('checkbox', { name: 'projects:read' })
    expect(readScope.getAttribute('aria-checked')).toBe('false')

    await user.type(
      screen.getByPlaceholderText('Local Jupyter'),
      'Local Jupyter',
    )
    expect(create.disabled).toBe(true)

    await user.click(readScope)
    expect(readScope.getAttribute('aria-checked')).toBe('true')
    expect(create.disabled).toBe(false)
    await user.click(create)
    expect(onCreate).toHaveBeenCalledWith(
      'Local Jupyter',
      ['projects:read'],
      null,
    )
  })

  it('gives the personal-token panel its own section heading', async () => {
    renderPanel()
    const panel = screen.getByRole('heading', {
      name: 'Personal tokens',
      level: 2,
    })
    const form = screen.getByRole('heading', {
      name: 'Create personal token',
      level: 3,
    })

    // The panel heading owns the create form, so the outline descends
    // H1 → H2 → H3 instead of jumping from the page title to an H3.
    const section = panel.closest('section')
    expect(section).not.toBeNull()
    expect(section).toBe(form.closest('section'))
  })

  it('confirms the copy when the clipboard takes the token', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    renderPanel({ revealed: REVEALED })

    await user.click(screen.getByRole('button', { name: 'Copy token' }))

    expect(writeText).toHaveBeenCalledWith(REVEALED.secret)
    expect(sonner.toast).toHaveBeenCalledWith('Token copied')
    expect(sonner.toast.error).not.toHaveBeenCalled()
  })

  it('states a refused copy instead of confirming one', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    )
    renderPanel({ revealed: REVEALED })

    await user.click(screen.getByRole('button', { name: 'Copy token' }))

    expect(sonner.toast.error).toHaveBeenCalled()
    expect(sonner.toast).not.toHaveBeenCalled()
  })
})
