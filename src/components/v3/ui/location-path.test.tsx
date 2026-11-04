import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { LocationPath } from './location-path'

const FULL =
  'Cambridge site / Cold room 1 / Freezer FZ-80-01 / Shelf 2 / Rack 3 / BX-LVV-07 / A2'

describe('LocationPath', () => {
  it('shows a short path as it is', () => {
    const { container } = render(<LocationPath path="-80 °C" />)
    expect(container.textContent).toBe('-80 °C')
  })

  it('shows the most specific places of a long path', () => {
    const { container } = render(<LocationPath path={FULL} />)
    const visible = container.querySelector('[aria-hidden="true"]')
    expect(visible?.textContent).toBe('… / Rack 3 / BX-LVV-07 / A2')
  })

  it('keeps the whole path for hover and assistive technology', () => {
    const { container } = render(<LocationPath path={FULL} />)
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe(FULL)
    expect(container.querySelector('.sr-only')?.textContent).toBe(FULL)
  })
})
