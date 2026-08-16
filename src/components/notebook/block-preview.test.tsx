import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { BlockPreview } from './block-preview'

afterEach(() => cleanup())

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const block = (type: string, payload: unknown) => ({
  id: 'b1',
  recordId: 'r1',
  type,
  payload: payload as Record<string, unknown>,
  payloadSchemaVersion: 1,
  order: 1,
  version: 1,
})

describe('BlockPreview callout (SCI-009 contract fix)', () => {
  it('renders the validated text/variant payload, not body/tone', () => {
    render(
      <BlockPreview
        block={block('callout', {
          text: 'Include a no-template control (NTC) in every qPCR run.',
          variant: 'warning',
        })}
      />,
    )
    expect(
      screen.getByText(
        'Include a no-template control (NTC) in every qPCR run.',
      ),
    ).toBeTruthy()
  })

  it('applies the warning variant styling', () => {
    const { container } = render(
      <BlockPreview
        block={block('callout', { text: 'Heads up', variant: 'warning' })}
      />,
    )
    // Warning callouts use a semantic warning background tint.
    const callout = container.querySelector('[class*="bg-warning"]')
    expect(callout).toBeTruthy()
  })

  it('renders the info variant with primary styling', () => {
    const { container } = render(
      <BlockPreview
        block={block('callout', { text: 'FYI', variant: 'info' })}
      />,
    )
    // Info callouts use a semantic info background tint.
    const callout = container.querySelector('[class*="bg-info"]')
    expect(callout).toBeTruthy()
  })

  it('renders nothing for the legacy body/tone payload shape', () => {
    const { container } = render(
      <BlockPreview block={block('callout', { body: 'old', tone: 'info' })} />,
    )
    // The renderer now reads text/variant; a payload without `text` renders
    // an empty callout body, confirming the old shape is no longer honoured.
    expect(container.textContent).not.toContain('old')
  })
})

describe('BlockPreview table (canonical string-array payload)', () => {
  it('renders column labels and row values from the canonical format', () => {
    render(
      <BlockPreview
        block={block('table', {
          columns: ['Timepoint', 'Replicate', 'Volume'],
          rows: [
            [0, 1, 100],
            [28, 1, 100],
          ],
        })}
      />,
    )
    expect(screen.getByText('Timepoint')).toBeTruthy()
    expect(screen.getByText('Replicate')).toBeTruthy()
    expect(screen.getByText('Volume')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByText('28')).toBeTruthy()
  })

  it('renders an empty body for null cells', () => {
    const { container } = render(
      <BlockPreview
        block={block('table', {
          columns: ['A', 'B'],
          rows: [[null, 'x']],
        })}
      />,
    )
    const cells = container.querySelectorAll('tbody td')
    expect(cells).toHaveLength(2)
    expect(cells[0].textContent).toBe('')
    expect(cells[1].textContent).toBe('x')
  })
})

describe('BlockPreview sheet (read-only preview)', () => {
  it('does not preview scientific-table payloads', () => {
    renderWithQuery(
      <BlockPreview
        block={block('sheet', {
          tableId: '00000000-0000-4000-8000-000000000170',
        })}
      />,
    )
    expect(screen.getByText(/no Sheet Instance/i)).toBeTruthy()
    expect(screen.queryByText(/scientific sheet/i)).toBeNull()
  })
})

describe('BlockPreview metric (number formatting)', () => {
  it('formats large integers with thousands separators', () => {
    render(
      <BlockPreview
        block={block('metric', {
          label: 'Viral titer',
          value: 23100000,
          unit: 'copies/mL',
        })}
      />,
    )
    expect(screen.getByText('23,100,000')).toBeTruthy()
  })

  it('renders the label in muted small text and the value prominently', () => {
    const { container } = render(
      <BlockPreview
        block={block('metric', { label: 'Volume', value: 100, unit: 'µL' })}
      />,
    )
    expect(screen.getByText('Volume')).toBeTruthy()
    const value = screen.getByText('100')
    // The value sits in a font-display dd, the label in a muted dt.
    expect(value.closest('dd')?.className).toContain('font-display')
    expect(container.querySelector('dt')?.className).toContain(
      'text-muted-foreground',
    )
  })

  it('leaves non-numeric string values untouched', () => {
    render(
      <BlockPreview
        block={block('metric', { label: 'Pass/fail', value: 'Pass' })}
      />,
    )
    expect(screen.getByText('Pass')).toBeTruthy()
  })
})
