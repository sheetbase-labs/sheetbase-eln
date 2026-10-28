/**
 * Settings → Storage and labels, label templates: the list, the live preview
 * and what a view-only person can and cannot change.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'

import { LabelTemplatesPanel } from './label-templates-panel'

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

afterEach(cleanup)

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  name: 'Sample tube',
  record_kind: 'sample',
  show_condition: true,
  show_use_by: true,
  show_lot: true,
  show_sample_type: false,
  width_mm: 50,
  height_mm: 25,
  barcode_type: 'qr',
  is_default: true,
  archived_at: null,
  created_at: '2026-10-28T00:00:00Z',
  updated_at: '2026-10-28T00:00:00Z',
}

function client(rows: unknown[] = [ROW]) {
  return {
    list: vi.fn(async () => rows),
    rpc: vi.fn(async () => ({
      ...ROW,
      name: 'Retain bottle',
      is_default: false,
    })),
  } as unknown as DataClient & { rpc: ReturnType<typeof vi.fn> }
}

function renderPanel(canManage: boolean, c = client()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LabelTemplatesPanel workspaceId="ws" canManage={canManage} client={c} />
    </QueryClientProvider>,
  )
  return c
}

describe('LabelTemplatesPanel', () => {
  it('lists templates with their size, code and default', async () => {
    renderPanel(true)
    const row = (await screen.findByRole('row', { name: /Sample tube/ }))
      .textContent
    expect(row).toContain('Default')
    expect(row).toContain('50 × 25 mm')
    expect(row).toContain('QR code')
  })

  it('previews the label as the form changes', async () => {
    const user = userEvent.setup()
    renderPanel(true)
    await user.click(await screen.findByRole('button', { name: 'Sample tube' }))
    expect(
      screen.getByRole('img', { name: /Label code resolving to/ }),
    ).toBeTruthy()
    await user.selectOptions(screen.getByLabelText(/^Code/), 'code128')
    expect(
      screen.getByRole('img', { name: /Barcode for SMP-2026-0142/ }),
    ).toBeTruthy()
    await user.click(screen.getByLabelText('Sample type'))
    expect(screen.getByText('Cell harvest')).toBeTruthy()
  })

  it('adds a template through the database function', async () => {
    const user = userEvent.setup()
    const c = renderPanel(true)
    await user.click(
      await screen.findByRole('button', { name: 'New template' }),
    )
    await user.type(screen.getByLabelText('Name'), 'Retain bottle')
    await user.click(screen.getByRole('button', { name: 'Add template' }))
    await waitFor(() =>
      expect(c.rpc).toHaveBeenCalledWith(
        'save_label_template',
        expect.objectContaining({
          p_workspace_id: 'ws',
          p_id: null,
          p_name: 'Retain bottle',
        }),
      ),
    )
  })

  it('will not save a width outside what a printer can do', async () => {
    const user = userEvent.setup()
    renderPanel(true)
    await user.click(
      await screen.findByRole('button', { name: 'New template' }),
    )
    await user.type(screen.getByLabelText('Name'), 'Wide')
    await user.clear(screen.getByLabelText('Width (mm)'))
    await user.type(screen.getByLabelText('Width (mm)'), '500')
    expect(
      screen.getByRole('button', { name: 'Add template' }).matches(':disabled'),
    ).toBe(true)
    expect(screen.getByText(/width is a whole number/)).toBeTruthy()
  })

  it('is read-only without manage access', async () => {
    const user = userEvent.setup()
    renderPanel(false)
    await user.click(await screen.findByRole('button', { name: 'Sample tube' }))
    expect(screen.queryByRole('button', { name: 'New template' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByLabelText('Name').matches(':disabled')).toBe(true)
  })
})
