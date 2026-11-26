import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { PaneErrorBoundary } from './pane-error-boundary'

function Broken({ broken }: { broken: boolean }) {
  if (broken) throw new Error('render failed')

  return <p>page is fine</p>
}

describe('PaneErrorBoundary', () => {
  it('keeps a page that throws inside its pane and lets it try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function Host() {
      const [broken, setBroken] = useState(true)

      return (
        <div>
          <p>other pane</p>
          <PaneErrorBoundary onRetry={() => setBroken(false)}>
            <Broken broken={broken} />
          </PaneErrorBoundary>
        </div>
      )
    }

    render(<Host />)

    expect(screen.getByText('other pane')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(
      'This pane stopped working',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('page is fine')).toBeTruthy()
  })
})
