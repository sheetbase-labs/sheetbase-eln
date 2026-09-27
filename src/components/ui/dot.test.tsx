import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Dot } from './dot'

afterEach(cleanup)

describe('Dot', () => {
  it('renders all nine tones', () => {
    const tones = [
      'neutral',
      'muted',
      'accent',
      'info',
      'success',
      'warning',
      'danger',
      'review',
      'analysis',
    ] as const
    for (const tone of tones) {
      const { container, unmount } = render(<Dot tone={tone} />)
      expect(
        container.querySelector(`[data-slot="dot"][data-tone="${tone}"]`),
      ).toBeTruthy()
      unmount()
    }
  })

  it('exposes an accessible name when labelled', () => {
    render(<Dot tone="success" label="Available" />)
    expect(
      document.querySelector('[data-slot="dot"]')?.getAttribute('aria-label'),
    ).toBe('Available')
  })
})
