import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BookInstrumentButton } from './book-instrument-button'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string
    search: Record<string, string>
    children: React.ReactNode
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

describe('BookInstrumentButton', () => {
  it('opens the schedule booking form for this experiment and returns to it', () => {
    render(<BookInstrumentButton experimentId="exp-1" />)
    const link = screen.getByText('Book instrument').closest('a')!
    const url = new URL(link.getAttribute('href')!, 'http://x.test')
    expect(url.pathname).toBe('/schedule')
    expect(url.searchParams.get('experiment')).toBe('exp-1')
    expect(url.searchParams.get('returnTo')).toBe('/experiments/exp-1')
  })
})
