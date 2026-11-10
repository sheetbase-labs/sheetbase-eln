import { render, screen } from '@testing-library/react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { helpArticles, helpTopics } from '#/components/help/help-content'
import { Route } from './records'

describe('HelpRecords', () => {
  it('keeps the design lifecycle accessible and navigation real', async () => {
    const router = createRouter({
      routeTree: createRootRoute({ component: Route.options.component }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    render(<RouterProvider router={router} />)

    await screen.findByRole('heading', {
      name: 'How records, reviews and signatures work',
      level: 1,
    })
    const diagram = screen.getByRole('img', { name: /Record lifecycle:/ })
    expect(diagram.querySelectorAll('rect')).toHaveLength(6)
    expect(diagram.textContent).toContain('Approved · signed')
    expect(diagram.textContent).toContain('Amendment · version 2')
    expect(
      diagram.querySelectorAll('path[marker-end], g[marker-end] path'),
    ).toHaveLength(7)
    expect(
      screen
        .getByRole('link', { name: 'Set up your signature' })
        .getAttribute('href'),
    ).toBe('/settings/account/signature')
    expect(
      screen
        .getByRole('link', { name: 'Keyboard shortcuts' })
        .getAttribute('href'),
    ).toBe('/help/shortcuts')
    expect(
      screen.getByRole('link', { name: 'Help' }).getAttribute('href'),
    ).toBe('/help')

    // The help index must not advertise anchors retired by the reference port.
    for (const topic of helpTopics) {
      if (topic.hash) expect(document.getElementById(topic.hash)).not.toBeNull()
    }

    for (const article of helpArticles) {
      const hash = z.string().safeParse(article.link.hash)

      if (article.link.to === '/help/records' && hash.success) {
        expect(document.getElementById(hash.data)).not.toBeNull()
      }
    }
  })
})
