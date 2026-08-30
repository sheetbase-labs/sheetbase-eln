import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SheetbaseGrid } from './sheetbase-grid'

vi.mock('./sheetbase-grid-client', () => ({
  SheetbaseGridClient: ({
    licenseKey,
    settings,
  }: {
    licenseKey: string
    settings: { data?: unknown[] }
  }) => {
    if (settings.data?.[0] === 'throw') throw new Error('initialisation failed')
    return <div data-testid="handsontable">{licenseKey}</div>
  },
}))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('SheetbaseGrid', () => {
  it('renders a clear failure state without a licence', () => {
    vi.stubEnv('VITE_HANDSONTABLE_LICENSE_KEY', '')
    render(<SheetbaseGrid settings={{ data: [['Sample', 1]] }} />)
    expect(screen.getByRole('alert').textContent).toContain(
      'A Handsontable licence is not configured.',
    )
  })

  it('loads the vendor grid only after mounting in the browser', async () => {
    vi.stubEnv('VITE_HANDSONTABLE_LICENSE_KEY', 'test-commercial-key')
    render(
      <SheetbaseGrid
        ariaLabel="Assay results Sheet"
        settings={{ data: [['Sample', 1]] }}
      />,
    )
    const region = screen.getByRole('region', {
      name: 'Assay results Sheet',
    })
    expect(region.className).toContain('focus-within:ring-2')
    expect(
      screen.getByText(/Shift\+Arrow extends the active range/),
    ).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain(
      'Preparing scientific sheet',
    )
    await waitFor(() => expect(screen.getByTestId('handsontable')).toBeTruthy())
  })

  it('server-renders only the stable loading state', () => {
    vi.stubEnv('VITE_HANDSONTABLE_LICENSE_KEY', 'test-commercial-key')
    const html = renderToString(
      <SheetbaseGrid settings={{ data: [['Sample', 1]] }} />,
    )
    expect(html).toContain('Preparing scientific sheet')
    expect(html).not.toContain('data-testid="handsontable"')
  })

  it('contains client initialisation failures', async () => {
    vi.stubEnv('VITE_HANDSONTABLE_LICENSE_KEY', 'test-commercial-key')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<SheetbaseGrid settings={{ data: ['throw'] }} />)
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'The scientific sheet could not start.',
      ),
    )
  })
})
