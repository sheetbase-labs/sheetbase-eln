/**
 * One panel, two screens' words. Personal tokens and service credentials are
 * the same panel with different copy, so every behaviour is asserted once per
 * copy and each screen's wording is pinned literally — a copy regression in
 * either preset fails here.
 *
 * Revoking a credential is permanent and rotating one invalidates the live
 * secret, so the row buttons only open the shared confirmation and the
 * callback fires from its action. The route surfaces a failed write
 * (src/routes/settings/api.tsx:150-154).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CredentialWire } from '#/lib/api-credential-admin'
import type {
  CreatedPersonalTokenWire,
  PersonalTokenWire,
} from '#/lib/personal-api-tokens'

import {
  SettingsCredentials,
  personalTokensCopy,
  serviceCredentialsCopy,
} from './settings-credentials'
import type { CredentialPanelCopy } from './settings-credentials'

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

/**
 * The wording each screen shows, spelled out rather than read from the preset:
 * a test that took its expectations from the copy object would reproduce a
 * regression there instead of catching it.
 */
type PanelCase = {
  name: string
  copy: CredentialPanelCopy
  row: PersonalTokenWire | CredentialWire
  revealed: CreatedPersonalTokenWire
  heading: string
  open: string
  formHeading: string
  placeholder: string
  create: string
  rotate: string
  revoke: string
  copyLabel: string
  copied: string
}

const PANELS: PanelCase[] = [
  {
    name: 'personal tokens',
    copy: personalTokensCopy,
    row: TOKEN,
    revealed: {
      id: 'token-2',
      secret: 'sb_pat_abcdef',
      displayPrefix: 'sb_pat_ab12',
      name: 'Local Jupyter',
      scopes: ['projects:read'],
    },
    heading: 'Personal tokens',
    open: 'New personal token',
    formHeading: 'Create personal token',
    placeholder: 'Local Jupyter',
    create: 'Create token',
    rotate: 'Rotate token',
    revoke: 'Revoke token',
    copyLabel: 'Copy token',
    copied: 'Token copied',
  },
  {
    name: 'service credentials',
    copy: serviceCredentialsCopy,
    row: CREDENTIAL,
    revealed: {
      id: 'cred-2',
      secret: 'sb_svc_abcdef',
      displayPrefix: 'sb_svc_ab12',
      name: 'Nightly backup',
      scopes: ['projects:read'],
    },
    heading: 'Workspace service credentials',
    open: 'New service credential',
    formHeading: 'Create service credential',
    placeholder: 'Nightly import',
    create: 'Create credential',
    rotate: 'Rotate credential',
    revoke: 'Revoke credential',
    copyLabel: 'Copy credential',
    copied: 'Credential copied',
  },
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  sonner.toast.mockClear()
  sonner.toast.error.mockClear()
})

function renderPanel(
  panel: PanelCase,
  { revealed = null }: { revealed?: PanelCase['revealed'] | null } = {},
) {
  const onCreate = vi.fn()
  const onRevoke = vi.fn()
  const onRotate = vi.fn()
  render(
    <SettingsCredentials
      copy={panel.copy}
      tokens={[panel.row]}
      revealed={revealed}
      onCreate={onCreate}
      onRevoke={onRevoke}
      onRotate={onRotate}
      onDismissRevealed={vi.fn()}
    />,
  )
  return { onCreate, onRevoke, onRotate }
}

describe.each(PANELS)('SettingsCredentials — $name', (panel) => {
  it('confirms a revoke before it fires, and revokes only from the confirmation', async () => {
    const user = userEvent.setup()
    const { onRevoke } = renderPanel(panel)

    const table = screen.getByRole('table', { name: panel.heading })
    await user.click(within(table).getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(onRevoke).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: panel.revoke }))
    expect(onRevoke).toHaveBeenCalledWith(panel.row.id)
  })

  it('confirms a rotate before it fires, and rotates only from the confirmation', async () => {
    const user = userEvent.setup()
    const { onRotate } = renderPanel(panel)

    const table = screen.getByRole('table', { name: panel.heading })
    await user.click(within(table).getByRole('button', { name: 'Rotate' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(onRotate).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: panel.rotate }))
    expect(onRotate).toHaveBeenCalledWith(panel.row.id)
  })

  it('requires an explicit scope instead of pre-granting projects:read', async () => {
    const user = userEvent.setup()
    const { onCreate } = renderPanel(panel)

    await user.click(screen.getByRole('button', { name: panel.open }))
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole<HTMLButtonElement>('button', {
      name: panel.create,
    })
    const readScope = within(dialog).getByRole('checkbox', {
      name: 'projects:read',
    })
    expect(readScope.getAttribute('aria-checked')).toBe('false')

    await user.type(
      within(dialog).getByPlaceholderText(panel.placeholder),
      panel.placeholder,
    )
    expect(submit.disabled).toBe(true)

    await user.click(readScope)
    expect(readScope.getAttribute('aria-checked')).toBe('true')
    expect(submit.disabled).toBe(false)
    await user.click(submit)
    expect(onCreate).toHaveBeenCalledWith(
      panel.placeholder,
      ['projects:read'],
      null,
    )
  })

  it('opens one create dialog from the section action', async () => {
    const user = userEvent.setup()
    renderPanel(panel)

    const heading = screen.getByRole('heading', {
      name: panel.heading,
      level: 2,
    })
    expect(heading.closest('section')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: panel.open }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: panel.formHeading }),
    ).toBeTruthy()
    expect(
      within(dialog).getByText(/Some scopes aren’t usable yet/),
    ).toBeTruthy()
  })

  it('hides revoked credentials by default and shows them on request', async () => {
    const user = userEvent.setup()
    render(
      <SettingsCredentials
        copy={personalTokensCopy}
        tokens={[
          TOKEN,
          {
            ...TOKEN,
            id: 'token-revoked',
            name: 'Retired notebook token',
            revokedAt: '2026-10-01T09:00:00.000Z',
          },
        ]}
        revealed={null}
        onCreate={vi.fn()}
        onRevoke={vi.fn()}
        onRotate={vi.fn()}
        onDismissRevealed={vi.fn()}
      />,
    )

    expect(screen.queryByText('Retired notebook token')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show inactive (1)' }))
    expect(
      screen.getAllByText('Retired notebook token').length,
    ).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Hide inactive' }))
    expect(screen.queryByText('Retired notebook token')).toBeNull()
  })

  it('summarizes a long scope list and expands it in place', async () => {
    const user = userEvent.setup()
    render(
      <SettingsCredentials
        copy={personalTokensCopy}
        tokens={[
          {
            ...TOKEN,
            scopes: ['projects:read', 'datasets:read', 'sheets:read'],
          },
        ]}
        revealed={null}
        onCreate={vi.fn()}
        onRevoke={vi.fn()}
        onRotate={vi.fn()}
        onDismissRevealed={vi.fn()}
      />,
    )

    const summary = screen.getAllByText('3 scopes')[0]
    expect(summary).toBeTruthy()
    await user.click(summary)
    expect(screen.getAllByText('datasets:read').length).toBeGreaterThan(0)
    expect(screen.getAllByText('sheets:read').length).toBeGreaterThan(0)
  })

  it('confirms the copy when the clipboard takes the secret', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    renderPanel(panel, { revealed: panel.revealed })

    await user.click(screen.getByRole('button', { name: panel.copyLabel }))

    expect(writeText).toHaveBeenCalledWith(panel.revealed.secret)
    expect(sonner.toast).toHaveBeenCalledWith(panel.copied)
    expect(sonner.toast.error).not.toHaveBeenCalled()
  })

  it('states a refused copy instead of confirming one', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    )
    renderPanel(panel, { revealed: panel.revealed })

    await user.click(screen.getByRole('button', { name: panel.copyLabel }))

    expect(sonner.toast.error).toHaveBeenCalled()
    expect(sonner.toast).not.toHaveBeenCalled()
  })
})
