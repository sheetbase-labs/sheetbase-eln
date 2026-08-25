import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ExportEvidenceButton,
  NotebookPrintStyles,
  PrintNotebookButton,
} from './print-notebook'

vi.mock('#/lib/notebook-experience', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadRevisionEvidence: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('PrintNotebookButton', () => {
  it('prints the current window', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<PrintNotebookButton />)
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalled()
    print.mockRestore()
  })
})

describe('NotebookPrintStyles', () => {
  it('includes print rules that hide chrome', () => {
    const { container } = render(<NotebookPrintStyles />)
    const css = container.querySelector('style')?.textContent ?? ''
    expect(css).toContain('@media print')
    expect(css).toContain('@page')
    expect(css).toContain('[data-slot="sidebar"]')
    expect(css).toContain('[data-slot="inspector"]')
    expect(css).toContain('[data-print-hide]')
    expect(css).toContain('[data-slot="block-toolbar"]')
  })
})

describe('ExportEvidenceButton', () => {
  it('is hidden when no revision is selected', () => {
    renderWithQuery(<ExportEvidenceButton />)
    expect(screen.queryByRole('link', { name: 'Export evidence' })).toBeNull()
  })

  it('links to the server-built evidence package for the revision', () => {
    renderWithQuery(
      <ExportEvidenceButton revisionId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" />,
    )
    const link = screen.getByRole('link', { name: 'Export evidence' })
    expect(link.getAttribute('href')).toBe(
      '/api/export/revision/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/package',
    )
  })
})
