import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ICON_NAMES, ICON_PATHS, Icon } from './index'

afterEach(cleanup)

describe('Icon', () => {
  it('ships the design icon set', () => {
    expect(ICON_NAMES).toHaveLength(49)
    expect(ICON_PATHS.home).toContain('path')
  })

  it('renders every icon as a hidden 16x16 currentColor svg', () => {
    ICON_NAMES.forEach((name) => {
      const { container, unmount } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeTruthy()
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
      expect(svg?.getAttribute('stroke')).toBe('currentColor')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      unmount()
    })
  })

  it('accepts a size and extra class', () => {
    const { container } = render(<Icon name="check" size={12} className="x" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('12')
    expect(svg?.getAttribute('class')).toContain('x')
  })
})
