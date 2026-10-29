// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveDataAccessHandle } from '#/lib/data-access-handles'
import { Popover } from '#/components/v3/ui/popover'
import { DataAccessPanel } from './data-access-panel'

function inPopover(ui: React.ReactNode) {
  return <Popover open>{ui}</Popover>
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))

afterEach(cleanup)

describe('DataAccessPanel', () => {
  it('shows the key, API route and Postgres name of a record', () => {
    render(
      inPopover(
        <DataAccessPanel
          handle={resolveDataAccessHandle('/experiments/EXP-2026-0145')!}
        />,
      ),
    )
    expect(screen.getByText('Data access · Experiment')).toBeTruthy()
    expect(screen.getByText('experiment')).toBeTruthy()
    expect(
      screen.getByText('/api/db/records?identifier=eq.EXP-2026-0145'),
    ).toBeTruthy()
    expect(screen.getByText('data.experiments')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /Settings/ }).getAttribute('href'),
    ).toBe('/settings/api')
  })

  it('offers the Python SDK beside the other snippets where it applies', () => {
    render(
      inPopover(
        <DataAccessPanel handle={resolveDataAccessHandle('/experiments')!} />,
      ),
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'curl',
      'Python SDK',
      'Python (requests)',
      'Python (psycopg)',
      'SQL',
    ])
  })

  it('offers copy buttons and a snippet per language', () => {
    render(
      inPopover(
        <DataAccessPanel handle={resolveDataAccessHandle('/samples?q=a')!} />,
      ),
    )
    expect(screen.getByRole('button', { name: 'Copy API route' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'curl',
      'Python (requests)',
      'Python (psycopg)',
      'SQL',
    ])
  })
})
