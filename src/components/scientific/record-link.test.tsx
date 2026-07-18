import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordLink } from './record-link'

// Stub the router Link as a plain anchor so no route tree is required.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: { to: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

afterEach(() => cleanup())

describe('RecordLink', () => {
  it('renders as a real link with an accessible name when available', () => {
    render(
      <RecordLink
        to="/samples/28"
        type="Sample"
        title="Sample 28"
        meta="Cell line"
      />,
    )
    const link = screen.getByRole('link', { name: 'Sample: Sample 28' })
    expect(link.getAttribute('href')).toBe('/samples/28')
    expect(screen.getByText('Cell line')).toBeTruthy()
  })

  it('renders as a non-interactive row when no `to` is provided', () => {
    render(<RecordLink type="Dataset" title="Raw qPCR" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Raw qPCR')).toBeTruthy()
  })

  it('renders the missing state honestly and never as a link', () => {
    render(
      <RecordLink to="/x" type="Sample" title="Sample 99" state="missing" />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Unavailable')).toBeTruthy()
  })

  it('renders the deleted state with a line-through title', () => {
    render(
      <RecordLink to="/x" type="Protocol" title="Old SOP" state="deleted" />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Deleted')).toBeTruthy()
    const title = screen.getByText('Old SOP')
    expect(title.className).toContain('line-through')
  })

  it('renders the permission-restricted state honestly', () => {
    render(
      <RecordLink
        to="/x"
        type="Dataset"
        title="Private dataset"
        state="permission-restricted"
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Permission restricted')).toBeTruthy()
  })

  it('preserves auxiliary actions and keeps them keyboard-operable', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <RecordLink
        to="/samples/28"
        type="Sample"
        title="Sample 28"
        actions={
          <button type="button" onClick={onOpen}>
            Open
          </button>
        }
      />,
    )
    const action = screen.getByRole('button', { name: 'Open' })
    await user.click(action)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is keyboard focusable as a link', () => {
    render(<RecordLink to="/samples/28" type="Sample" title="Sample 28" />)
    const link = screen.getByRole('link', { name: 'Sample: Sample 28' })
    link.focus()
    expect(document.activeElement).toBe(link)
  })
})
