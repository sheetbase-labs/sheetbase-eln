/**
 * The sliding tab mark: it measures the current tab, follows a change of tab,
 * and leaves the tabs to draw their own mark where it cannot measure.
 */
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TabIndicator } from './tab-indicator'

class NoopResizeObserver {
  observe() {}
  disconnect() {}
}

function Strip() {
  const [current, setCurrent] = useState(0)

  return (
    <div data-tabs="strip" className="relative">
      {['Open', 'All'].map((label, index) => (
        <button
          key={label}
          type="button"
          aria-current={index === current ? 'page' : undefined}
          onClick={() => setCurrent(index)}
        >
          {label}
        </button>
      ))}
      <TabIndicator />
    </div>
  )
}

function measure() {
  // A test DOM has no layout: each tab reports a box from its text.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return (this.textContent?.length ?? 0) * 10
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.textContent === 'All' ? 60 : 0
    },
  )
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(0)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
}

describe('TabIndicator', () => {
  it('sits under the current tab and follows it when the tab changes', async () => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver)
    measure()

    const { container, getByText } = render(<Strip />)
    const strip = container.querySelector<HTMLElement>('[data-tabs]')
    const mark = container.querySelector<HTMLElement>('.sb-tab-indicator')

    expect(strip?.dataset.indicator).toBe('placed')
    expect(mark?.style.getPropertyValue('--tab-x')).toBe('0px')
    expect(mark?.style.getPropertyValue('--tab-w')).toBe('40px')

    await act(async () => {
      getByText('All').click()
    })

    // A later placement slides rather than jumps.
    expect(strip?.dataset.indicator).toBe('on')
    expect(mark?.style.getPropertyValue('--tab-x')).toBe('60px')
    expect(mark?.style.getPropertyValue('--tab-w')).toBe('30px')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })

  it('leaves the tabs their own mark where nothing can be measured', () => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver)

    const { container } = render(<Strip />)

    expect(
      container.querySelector<HTMLElement>('[data-tabs]')?.dataset.indicator,
    ).toBeUndefined()
  })
})
