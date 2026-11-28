/**
 * A list keeps its place when you come back to it, even when its rows take a
 * few seconds to arrive.
 */
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { resetPaneScroll, usePaneScroll } from './use-pane-scroll'

afterEach(() => {
  resetPaneScroll()
  vi.useRealTimers()
})

function Pane({ pageKey }: { pageKey: string }) {
  const root = useRef<HTMLDivElement>(null)
  const scroll = usePaneScroll(root, pageKey)

  return (
    <div ref={root} {...scroll}>
      <div className="list-scroller" data-testid="list" />
    </div>
  )
}

/** jsdom lays nothing out: give the scroller a height, and rows when asked. */
function sized(el: HTMLElement, rows: () => boolean) {
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(el, 'scrollHeight', {
    get: () => (rows() ? 5000 : 500),
    configurable: true,
  })
}

it('puts a list back where it was left when its rows arrive late', async () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] })

  const first = render(<Pane pageKey="/experiments" />)
  const list = first.getByTestId('list')

  sized(list, () => true)
  list.scrollTop = 400
  first.container.firstElementChild?.dispatchEvent(
    new WheelEvent('wheel', { bubbles: true }),
  )
  list.dispatchEvent(new Event('scroll', { bubbles: true }))
  first.unmount()

  let rowsBack = false
  const back = render(<Pane pageKey="/experiments" />)
  const again = back.getByTestId('list')

  sized(again, () => rowsBack)

  // The rows take four seconds to come back, longer than the hold itself.
  await act(async () => {
    vi.advanceTimersByTime(4000)
  })
  expect(again.scrollTop).toBe(0)
  rowsBack = true
  await act(async () => {
    vi.advanceTimersByTime(100)
  })

  expect(again.scrollTop).toBe(400)
})
