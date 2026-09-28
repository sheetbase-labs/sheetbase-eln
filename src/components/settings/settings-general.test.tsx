import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SettingsGeneral } from './settings-general'
import { updateWorkspaceGeneral } from '#/lib/workspace-general'
import type * as workspaceGeneralModule from '#/lib/workspace-general'

vi.mock('#/lib/workspace-general', async (importOriginal) => {
  const actual = await importOriginal<typeof workspaceGeneralModule>()
  return {
    ...actual,
    fetchWorkspaceGeneral: vi.fn(async () => ({
      site: 'Cambridge',
      timezone: 'Europe/London',
      dateFormat: 'd MMM yyyy',
      numberFormat: 'decimal' as const,
      idPrefixes: { experiment: 'EXP' },
    })),
    updateWorkspaceGeneral: vi.fn(async () => {}),
    updateWorkspaceIdPrefixes: vi.fn(async () => {}),
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
    expect(await screen.findByDisplayValue('Cambridge')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(vi.mocked(updateWorkspaceGeneral)).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ site: 'Cambridge' }),
      ),
    )
  })
})
