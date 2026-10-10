import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

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
})
