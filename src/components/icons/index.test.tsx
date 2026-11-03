import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ICON_NAMES, ICONS, Icon } from './index'

afterEach(cleanup)

describe('Icon', () => {
  it('ships the design icon set', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(100)
    expect(ICONS.home.length).toBeGreaterThan(0)
  })

  it('renders every icon as a hidden 16px svg', () => {
    ICON_NAMES.forEach((name) => {
      const { container, unmount } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg).toBeTruthy()
      expect(svg?.getAttribute('width')).toBe('16')
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
