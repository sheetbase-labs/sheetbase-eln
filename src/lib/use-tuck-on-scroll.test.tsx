import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useTuckOnScroll } from './use-tuck-on-scroll'

function Probe({ resetKey }: { resetKey?: string }) {
  const tucked = useTuckOnScroll(resetKey)
  return (
    <div>
      <div data-testid="pane" style={{ overflow: 'auto' }} />
      <output>{tucked ? 'tucked' : 'shown'}</output>
    </div>
  )
}

afterEach(() => cleanup())

function scrollTo(element: Element, top: number) {
  act(() => {
    element.scrollTop = top
    element.dispatchEvent(new Event('scroll'))
  })
}

describe('useTuckOnScroll', () => {
  it('tucks while scrolling down inside a pane and returns on scrolling up', () => {
    const { getByTestId, container } = render(<Probe />)
    const pane = getByTestId('pane')
    const state = () => container.querySelector('output')?.textContent
    expect(state()).toBe('shown')
    scrollTo(pane, 200)
    expect(state()).toBe('tucked')
    scrollTo(pane, 150)
    expect(state()).toBe('shown')
    scrollTo(pane, 400)
    expect(state()).toBe('tucked')
    scrollTo(pane, 0)
    expect(state()).toBe('shown')
  })

  it('ignores small movements', () => {
    const { getByTestId, container } = render(<Probe />)
    scrollTo(getByTestId('pane'), 4)
    expect(container.querySelector('output')?.textContent).toBe('shown')
  })

  it('comes back when the page changes', () => {
    const { getByTestId, container, rerender } = render(<Probe resetKey="/a" />)
    scrollTo(getByTestId('pane'), 300)
    expect(container.querySelector('output')?.textContent).toBe('tucked')
    rerender(<Probe resetKey="/b" />)
    expect(container.querySelector('output')?.textContent).toBe('shown')
  })
})
