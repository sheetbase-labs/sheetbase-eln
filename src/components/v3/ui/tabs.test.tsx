/**
 * The tab contract (see the module comment in `tabs.tsx`).
 *
 * One component, two modes, and the announcement each mode owes:
 *
 * - `mode="state"` is a tablist: one tab stop, ArrowLeft/ArrowRight and
 *   ArrowUp/ArrowDown, Home/End, `aria-selected`, and activation that follows
 *   focus.
 * - `mode="url"` is a nav of links: Tab reaches each one, the current tab
 *   carries `aria-current="page"`, and nothing announces itself as a tab that
 *   cannot be arrowed to.
 *
 * `Link` is mocked because the real one needs a router above it; the assertions
 * are on the props and attributes the strip gives it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Tabs } from './tabs'
import type { LinkProps } from '@tanstack/react-router'
import type * as router from '@tanstack/react-router'

afterEach(() => {
  cleanup()
})

const lastLinks = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    Link: ({
      children,
      className,
      'aria-current': ariaCurrent,
      ...rest
    }: {
      children?: React.ReactNode
      className?: string
      'aria-current'?: 'page'
    } & Record<string, unknown>) => {
      lastLinks.props.push({ ...rest, className, ariaCurrent })
      return (
        <a href="#" className={className} aria-current={ariaCurrent}>
          {children}
        </a>
      )
    },
  }
})

const MODES = [
  { key: 'chart', label: 'Chart builder' },
  { key: 'analyse', label: 'Analyse', count: 2 },
  { key: 'compare', label: 'Compare' },
]

function StateStrip({
  onValueChange = () => {},
  value = 'chart',
}: {
  onValueChange?: (key: string) => void
  value?: string
}) {
  return (
    <Tabs
      mode="state"
      label="Studio mode"
      value={value}
      onValueChange={onValueChange}
      items={MODES}
    />
  )
}

function ControlledStrip() {
  const [value, setValue] = useState('chart')
  return <StateStrip value={value} onValueChange={setValue} />
}

const tabs = () => screen.getAllByRole<HTMLButtonElement>('tab')
const tabIndexes = () => tabs().map((tab) => tab.getAttribute('tabindex'))
const selected = () => tabs().map((tab) => tab.getAttribute('aria-selected'))

describe('Tabs — state mode is a tablist', () => {
  it('keeps one tab stop, moves selection with arrows and wraps at the ends', async () => {
    const user = userEvent.setup()
    render(<ControlledStrip />)

    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe(
      'Studio mode',
    )
    expect(tabIndexes()).toEqual(['0', '-1', '-1'])
    expect(selected()).toEqual(['true', 'false', 'false'])

    tabs()[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tabs()[1])
    expect(selected()).toEqual(['false', 'true', 'false'])
    expect(tabIndexes()).toEqual(['-1', '0', '-1'])

    // Ends: End jumps to the last tab, ArrowRight wraps to the first, Home
    // returns.
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(tabs()[2])
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tabs()[0])
    expect(selected()).toEqual(['true', 'false', 'false'])
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(tabs()[0])
  })

  it('renders the count beside the label and none when there is no count', () => {
    render(<StateStrip />)
    expect(tabs()[1].textContent).toBe('Analyse 2')
    expect(tabs()[0].textContent).toBe('Chart builder')
  })

  it('hands the new key to the caller, and only when it changes', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const { rerender } = render(<StateStrip onValueChange={onValueChange} />)
    await user.click(tabs()[1])
    expect(onValueChange).toHaveBeenCalledWith('analyse')

    // The current tab is not re-committed.
    onValueChange.mockClear()
    rerender(<StateStrip onValueChange={onValueChange} value="analyse" />)
    await user.click(tabs()[1])
    expect(onValueChange).not.toHaveBeenCalled()
  })
})

describe('Tabs — url mode is a nav of links', () => {
  const items = [
    {
      key: 'all',
      label: 'All',
      count: 4,
      link: { to: '/datasets', search: { tab: undefined } } as LinkProps,
    },
    {
      key: 'mine',
      label: 'Mine',
      count: 1,
      link: { to: '/datasets', search: { tab: 'mine' } } as LinkProps,
    },
    {
      key: 'locked',
      label: 'Locked',
      link: { to: '/datasets', search: { tab: 'locked' } } as LinkProps,
    },
  ]

  it('marks the named key current, once, and announces no tabs', () => {
    lastLinks.props.length = 0
    render(<Tabs mode="url" label="Dataset lists" value="mine" items={items} />)

    const nav = screen.getByRole('navigation', { name: 'Dataset lists' })
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'All 4',
      'Mine 1',
      'Locked',
    ])
    expect(
      links.map((link) => link.getAttribute('aria-current') ?? null),
    ).toEqual([null, 'page', null])
    expect(screen.queryAllByRole('tab')).toEqual([])
    expect(nav.contains(links[0])).toBe(true)

    // A link that also repeats the full URL is the one the router marks
    // active, so the router and the key cannot disagree about which is current.
    expect(lastLinks.props.map((props) => props.activeOptions)).toEqual([
      { exact: true, includeSearch: true },
      { exact: true, includeSearch: true },
      { exact: true, includeSearch: true },
    ])
  })

  it('leaves the current tab to the router when the caller names no key', () => {
    lastLinks.props.length = 0
    render(
      <Tabs
        mode="url"
        label="Model sections"
        items={[
          {
            label: 'Fields',
            link: {
              to: '/models/$modelId/fields',
              params: { modelId: 'm-1' },
            } as LinkProps,
          },
          {
            label: 'Versions',
            link: {
              to: '/models/$modelId/versions',
              params: { modelId: 'm-1' },
            },
          },
        ]}
      />,
    )
    expect(screen.queryAllByRole('tab')).toEqual([])
    // No key: the strip does not claim a current tab, and a search parameter
    // (a filter, say) must not unhighlight the section you are standing in.
    expect(
      screen
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-current') ?? null),
    ).toEqual([null, null])
    expect(lastLinks.props.map((props) => props.activeOptions)).toEqual([
      { exact: false, includeSearch: false },
      { exact: false, includeSearch: false },
    ])
  })
})
