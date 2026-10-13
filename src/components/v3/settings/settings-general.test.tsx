import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsGeneral } from './settings-general'
import {
  updateWorkspaceGeneral,
  updateWorkspaceName,
  updateWorkspaceOfflineEditing,
  updateWorkspacePublicationPolicy,
} from '#/lib/workspace-general'
import type * as workspaceGeneralModule from '#/lib/workspace-general'

vi.mock('#/lib/workspace-general', async (importOriginal) => {
  const actual = await importOriginal<typeof workspaceGeneralModule>()
  return {
    ...actual,
    fetchWorkspaceGeneral: vi.fn(async () => ({
      name: 'Process Development',
      site: 'Cambridge',
      timezone: 'Europe/London',
      dateFormat: 'd MMM yyyy',
      numberFormat: 'decimal' as const,
      publicationApprovalRequired: false,
      offlineEditingAllowed: true,
      idPrefixes: { experiment: 'EXP' },
    })),
    updateWorkspaceGeneral: vi.fn(async () => {}),
    updateWorkspaceIdPrefixes: vi.fn(async () => {}),
    updateWorkspaceName: vi.fn(async () => {}),
    updateWorkspacePublicationPolicy: vi.fn(async () => {}),
    updateWorkspaceOfflineEditing: vi.fn(async () => {}),
  }
})

function renderSection() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SettingsGeneral workspaceId="ws-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsGeneral', () => {
  it('loads the workspace settings and saves them', async () => {
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByDisplayValue('Process Development')).toBeTruthy()
    expect(screen.getByDisplayValue('Cambridge')).toBeTruthy()
    const toggle = screen.getByRole('checkbox', {
      name: /Require approval before publishing dataset schema versions/,
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')

    // EXP-05.5: offline editing is a workspace-wide switch.
    const offline = screen.getByRole('checkbox', {
      name: /Allow offline editing on this workspace’s devices/,
    })
    expect(offline.getAttribute('aria-checked')).toBe('true')
    await user.click(offline)
    expect(offline.getAttribute('aria-checked')).toBe('false')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(vi.mocked(updateWorkspaceGeneral)).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ site: 'Cambridge' }),
      ),
    )
    expect(vi.mocked(updateWorkspaceName)).toHaveBeenCalledWith(
      'ws-1',
      'Process Development',
    )
    await waitFor(() =>
      expect(updateWorkspacePublicationPolicy).toHaveBeenCalledWith(
        'ws-1',
        true,
      ),
    )
    await waitFor(() =>
      expect(updateWorkspaceOfflineEditing).toHaveBeenCalledWith('ws-1', false),
    )
  })

  it('refuses a time zone that is not a real IANA zone', async () => {
    const user = userEvent.setup()
    renderSection()
    const timezone = await screen.findByLabelText<HTMLInputElement>(
      'Time zone',
    )
    const save = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Save changes',
    })
    expect(save.disabled).toBe(true)

    await user.clear(timezone)
    await user.type(timezone, 'Mars/Olympus')
    expect(screen.getByText(/valid IANA time zone/i)).toBeTruthy()
    expect(save.disabled).toBe(true)
    expect(timezone.getAttribute('aria-invalid')).toBe('true')

    // Restoring the stored zone clears the error; the form is unchanged, so
    // there is still nothing to save.
    await user.clear(timezone)
    await user.type(timezone, 'Europe/London')
    expect(screen.queryByText(/valid IANA time zone/i)).toBeNull()
    expect(save.disabled).toBe(true)
    expect(vi.mocked(updateWorkspaceGeneral)).not.toHaveBeenCalled()
  })

  it('enables Save only once a field has changed', async () => {
    renderSection()
    const save = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Save changes',
    })
    await screen.findByDisplayValue('Process Development')
    expect(save.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText('Site'), '!')
    expect(save.disabled).toBe(false)
  })

  it('treats a cleared record-ID prefix as unchanged', async () => {
    const user = userEvent.setup()
    renderSection()
    const save = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Save changes',
    })
    await screen.findByDisplayValue('Process Development')
    const prefix = screen.getByLabelText<HTMLInputElement>('sample prefix')
    expect(save.disabled).toBe(true)

    // Type then clear: nothing differs from the stored map, so Save returns to
    // disabled rather than staying enabled forever.
    await user.type(prefix, 'QA2X')
    expect(save.disabled).toBe(false)
    await user.clear(prefix)
    expect(prefix.value).toBe('')
    expect(save.disabled).toBe(true)
    expect(vi.mocked(updateWorkspaceGeneral)).not.toHaveBeenCalled()
  })
})
