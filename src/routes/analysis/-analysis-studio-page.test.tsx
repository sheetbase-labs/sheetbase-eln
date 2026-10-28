/**
 * WCAG 2.1.1 (Keyboard) and the ARIA tabs pattern — the Analysis Studio's mode
 * switch announces `role="tab"` on each control inside a `role="tablist"`, so it
 * owes the tablist's keyboard contract: a single tab stop, ArrowLeft/ArrowRight
 * (and ArrowUp/ArrowDown) between the tabs, Home/End at the ends, and selection
 * that follows the focused tab.
 *
 * It shipped with none of it: three buttons, all in the tab order, that a
 * screen-reader user was told were tabs and could not arrow through. The
 * assertions below are written against the behaviour, not the mechanism, so
 * they hold when the strip moves onto the shared tab component.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AnalysisStudio,
  AnalysisStudioHeader,
  SavedViewsPanel,
} from './-analysis-studio-page'
import type * as router from '@tanstack/react-router'
import type * as studioData from '#/lib/analysis-studio-data'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    getRouteApi: () => ({
      useSearch: () => ({}),
      useRouteContext: () => ({
        context: { user: { id: 'user-1' }, workspace: { id: 'ws-1' } },
      }),
    }),
    useBlocker: () => ({}),
    useNavigate: () => vi.fn(),
    Link: ({ children, to }: { children?: React.ReactNode; to?: unknown }) => (
      <a href={typeof to === 'string' ? to : '#'}>{children}</a>
    ),
  }
})

vi.mock('#/lib/analysis-studio-data', async (importOriginal) => {
  const actual = await importOriginal<typeof studioData>()
  return {
    ...actual,
    analysisStudioQueryKeys: {
      views: ['analysis-views'] as const,
      datasets: ['analysis-datasets'] as const,
      view: (id: string) => ['analysis-view', id] as const,
      sourceStatus: (id: string) =>
        ['analysis-view', id, 'source-status'] as const,
      citations: (id: string) => ['analysis-view', id, 'citations'] as const,
    },
    fetchDatasetSummaries: async () => [],
    fetchAnalysisViews: async () => [],
  }
})

function renderStudio() {
  const Studio = AnalysisStudio as React.ComponentType
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Studio />
    </QueryClientProvider>,
  )
}

/** The studio's mode switch, however its items are rendered. */
function studioTabs() {
  const list = document.querySelector('[role="tablist"]')
  if (!list) throw new Error('the studio mode switch is not a tablist')
  return Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
}

afterEach(() => {
  cleanup()
})

describe('Analysis Studio mode switch', () => {
  it('keeps one tab stop and moves selection with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    renderStudio()
    const tabs = studioTabs()
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Chart builder',
      'Analyse',
      'Compare',
    ])

    // One tab stop: only the selected tab is in the tab order.
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
    ])

    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual([
      '-1',
      '0',
      '-1',
    ])

    // Wrap backwards from the first tab to the last.
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(tabs[2])
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tabs[0])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(tabs[0])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })
})

describe('saved views panel — Save as new (J-DAT-11)', () => {
  const panel = (selectedViewId: string | null, onSave = vi.fn()) =>
    render(
      <SavedViewsPanel
        views={[]}
        selectedViewId={selectedViewId}
        viewName="Cited analysis"
        onViewNameChange={vi.fn()}
        onLoad={vi.fn()}
        onSave={onSave}
        onDelete={vi.fn()}
        saving={false}
        canSave
      />,
    )

  it('offers Save as new beside Update once a view is loaded', async () => {
    const onSave = vi.fn()
    panel('view-1', onSave)
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: 'Save as new analysis view' }),
    )
    expect(onSave).toHaveBeenLastCalledWith(true)

    await user.click(screen.getByRole('button', { name: 'Save analysis view' }))
    expect(onSave).toHaveBeenLastCalledWith(false)
  })

  it('does not offer it for a view that has not been saved yet', () => {
    panel(null)
    expect(
      screen.queryByRole('button', { name: 'Save as new analysis view' }),
    ).toBeNull()
  })
})

describe('Analysis Studio return path (Phase 4)', () => {
  function header(returnTo?: string) {
    render(
      <AnalysisStudioHeader
        datasets={[]}
        loading={false}
        error={null}
        selectedDatasetId={null}
        onSelect={() => undefined}
        returnTo={returnTo}
      />,
    )
  }

  it('offers the way back to the page that opened the studio', () => {
    header('/experiments/e1/results')
    expect(
      screen
        .getByRole('link', { name: 'Back to what you were doing' })
        .getAttribute('href'),
    ).toBe('/experiments/e1/results')
  })

  it('offers no way back when the studio was opened directly', () => {
    header()
    expect(screen.queryByRole('link', { name: /Back to/ })).toBeNull()
  })
})
