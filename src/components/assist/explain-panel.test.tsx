/**
 * ExplainPanel tests (ASSIST-01). The panel is read-only: it renders the
 * grounded facts, marks model phrasing as assistance, and offers no
 * mutation path.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { explainBlockValidation } from '#/lib/assist-explain'
import type { AssistExplanation } from '#/lib/assist-explain'

import { ExplainPanel } from './explain-panel'

afterEach(cleanup)

function explanation(): AssistExplanation {
  const built = explainBlockValidation({
    blockType: 'chart',
    errors: [
      {
        code: 'missing_required_field',
        field: 'spec',
        message: 'spec is required.',
      },
    ],
  })
  if (!built) throw new Error('fixture explanation must build')
  return built
}

describe('ExplainPanel', () => {
  it('renders what failed, why with citations, and how to resolve', () => {
    render(<ExplainPanel explanation={explanation()} />)
    expect(screen.getByText(/cannot save/)).toBeTruthy()
    expect(
      screen.getAllByText(/\[Block rule missing_required_field\]/).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText(/Nothing was written/)).toBeTruthy()
    expect(screen.getByText(/How to resolve/)).toBeTruthy()
    expect(screen.getByText(/Cited sources/)).toBeTruthy()
    expect(screen.getByText(/Not authoritative/)).toBeTruthy()
  })

  it('marks model phrasing as assistance beside the facts', () => {
    render(
      <ExplainPanel
        explanation={explanation()}
        phrasing={{
          text: 'Stub phrasing.',
          model: 'sheetbase-assist-1',
          assistance: true,
        }}
      />,
    )
    expect(screen.getByText(/Worded by/)).toBeTruthy()
    expect(screen.getByText('Stub phrasing.')).toBeTruthy()
    // Grounded facts stay rendered alongside the phrasing.
    expect(
      screen.getAllByText(/\[Block rule missing_required_field\]/).length,
    ).toBeGreaterThan(0)
  })

  it('exposes no mutation affordance', () => {
    const { container } = render(<ExplainPanel explanation={explanation()} />)
    expect(container.querySelector('button')).toBeNull()
  })
})
