import { cleanup, render, screen, within } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { partsProgress } from '#/lib/experiment-parts'
import type { ExperimentPart } from '#/lib/experiment-parts'
import { PartFooter, PartsStrip, UpNextBanner } from './parts-strip'
import { partDayLine, partHref } from './part-presentation'

function renderParts(ui: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(ui, {
    wrapper: ({ children }) => (
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    ),
  })
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

const part = (
  id: string,
  position: number,
  extra: Partial<ExperimentPart> = {},
): ExperimentPart => ({
  id,
  recordId: 'rec',
  position,
  title: `Stage ${position}`,
  dayOffset: position - 1,
  assigneeUserId: null,
  openedAt: null,
  completedAt: null,
  completedByUserId: null,
  requiresSignOff: false,
  signedOffAt: null,
  signedOffByUserId: null,
  signoffId: null,
  ...extra,
})

const parts = partsProgress(
  [
    part('a', 1, {
      completedAt: '2026-11-02T15:00:00Z',
      completedByUserId: 'user-mei',
    }),
    part('b', 2),
    part('c', 3),
  ],
  [],
)

const STARTED = '2026-11-02T09:00:00Z'

describe('partHref and partDayLine', () => {
  it('links to the part by its number', () => {
    expect(partHref('exp-1', 3)).toBe('/experiments/exp-1/notebook/3')
  })

  it('says the day and date, or today', () => {
    expect(
      partDayLine(parts[1], STARTED, new Date('2026-11-02T10:00:00Z')),
    ).toBe('Day 1 · Tue 3 Nov')
    expect(
      partDayLine(parts[1], STARTED, new Date('2026-11-03T10:00:00Z')),
    ).toBe('Day 1 · Today')
  })
})

describe('PartsStrip', () => {
  it('links every part, marks the one shown and says which are done', () => {
    renderParts(
      <PartsStrip
        expId="exp-1"
        parts={parts}
        shown={parts[1]}
        startedAt={STARTED}
      />,
    )
    const strip = screen.getByTestId('parts-strip')
    const links = within(strip).getAllByRole('link')
    const hrefs = links.map((link) => link.getAttribute('href'))
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/experiments/exp-1/notebook/1',
        '/experiments/exp-1/notebook/2',
        '/experiments/exp-1/notebook/3',
      ]),
    )

    const current = links.find(
      (link) => link.getAttribute('aria-current') === 'page',
    )

    expect(current?.getAttribute('href')).toBe('/experiments/exp-1/notebook/2')
    expect(strip.textContent).toContain('Stage 1')
    expect(strip.textContent).toContain('Done')
    expect(strip.textContent).toContain('Now')
  })
})

describe('PartFooter', () => {
  it('shows who did the part before and the part that follows', () => {
    renderParts(
      <PartFooter
        expId="exp-1"
        parts={parts}
        shown={parts[1]}
        startedAt={STARTED}
        nameOf={(id) => (id === 'user-mei' ? 'Mei L.' : id)}
      />,
    )
    expect(screen.getByTestId('part-previous').textContent).toContain(
      'Done by Mei L.',
    )
    expect(screen.getByTestId('part-next').textContent).toContain('Stage 3')
  })

  it('has no card past the last part, and none at all for a single part', () => {
    const { rerender } = renderParts(
      <PartFooter
        expId="exp-1"
        parts={parts}
        shown={parts[2]}
        startedAt={STARTED}
        nameOf={String}
      />,
    )

    expect(screen.queryByTestId('part-next')).toBeNull()
    expect(screen.getByTestId('part-previous')).toBeTruthy()
    rerender(
      <PartFooter
        expId="exp-1"
        parts={[parts[0]]}
        shown={parts[0]}
        startedAt={STARTED}
        nameOf={String}
      />,
    )
    expect(screen.queryByTestId('part-previous')).toBeNull()
  })
})

describe('UpNextBanner', () => {
  it('points to the part to work on now', () => {
    renderParts(
      <UpNextBanner expId="exp-1" shown={parts[2]} current={parts[1]} />,
    )
    const banner = screen.getByTestId('part-up-next')
    expect(banner.textContent).toContain('Up next: Part 3')
    expect(
      within(banner)
        .getByRole('link', { name: 'Go to Part 2' })
        .getAttribute('href'),
    ).toBe('/experiments/exp-1/notebook/2')
  })
})
