import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { contextHelpFor } from './context-help-topics'
import { ContextHelp } from './context-help'

const state = vi.hoisted(() => ({ pathname: '/' }))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({
    select,
  }: {
    select: (s: { location: { pathname: string } }) => string
  }) => select({ location: { pathname: state.pathname } }),
  Link: ({ to, children }: { to?: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

afterEach(() => {
  cleanup()
  state.pathname = '/'
})

describe('contextHelpFor', () => {
  it('matches the most specific page first', () => {
    expect(contextHelpFor('/pipelines/runs/abc')?.title).toBe('Pipeline run')
    expect(contextHelpFor('/pipelines/def-1/steps')?.title).toBe('Pipelines')
    expect(contextHelpFor('/settings/clients')?.title).toBe('Clients')
  })

  it('does not match a path that only shares a prefix of letters', () => {
    expect(contextHelpFor('/searching')).toBeNull()
    expect(contextHelpFor('/')).toBeNull()
  })
})

describe('ContextHelp', () => {
  it('shows nothing on a page with no help written for it', () => {
    state.pathname = '/'
    render(<ContextHelp />)
    expect(
      screen.queryByRole('button', { name: 'Help for this page' }),
    ).toBeNull()
  })

  it('explains the page and links to the Help centre', () => {
    state.pathname = '/evidence/rev-1'
    render(<ContextHelp />)
    fireEvent.click(screen.getByRole('button', { name: 'Help for this page' }))
    expect(screen.getByText('Signed evidence')).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Help and shortcuts' })
        .getAttribute('href'),
    ).toBe('/help')
    expect(
      screen.getByRole('link', {
        name: 'How records, reviews and signatures work',
      }),
    ).toBeTruthy()
  })
})
