import { Link } from '@tanstack/react-router'

import { Breadcrumb } from '#/components/v3/ui/breadcrumb'
import {
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
} from '#/components/component-compare/types'

/**
 * Pair — the page's location.
 *
 * Ours: `Breadcrumb` (`src/components/v3/ui/breadcrumb.tsx`), which
 * `PageHeader` renders for its `trail` prop and the two help articles render in
 * their own header. The trail is data: an `ol` of `li`s, a separator the
 * accessibility tree does not read, and `aria-current="page"` on the crumb you
 * are standing on.
 *
 * Theirs: the crumb line as 24 files composed it. A `nav` with a run of
 * fragments inside; the separator a text node between them; the identifier
 * wrapped by hand at each site; and no `aria-current` anywhere, so the "you are
 * here" half of a breadcrumb was missing on every screen in the app.
 *
 * The two are one line of text either way, which is the point: what changed is
 * the tree (list structure, hidden separator, current page), and that is what
 * the checklist and the axe run are asked about.
 */

function OurTrailColumn({ scenario }: ComparisonColumnProps) {
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  return (
    <div className="flex flex-col gap-2" data-comparison-list="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      <Breadcrumb
        trail={[
          { label: 'Projects', link: { to: '/' } },
          {
            label: 'LVV stability, 2–8 °C hold',
            link: {
              to: '/projects/$projectId',
              params: { projectId: 'LVV-stability' },
            },
          },
          { label: 'Experiments', mono: true },
        ]}
      />
    </div>
  )
}

function HandSpelledTrailColumn({ scenario }: ComparisonColumnProps) {
  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }
  return (
    <div className="flex flex-col gap-2" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {/* The line 24 files passed as a node, as they wrote it: the separator is
          a text node in the tree and nothing marks the current page. */}
      <nav
        aria-label="Breadcrumb"
        className="truncate text-label text-fg-muted"
      >
        <>
          <Link to="/" className="text-link">
            Projects
          </Link>{' '}
          /{' '}
          <Link
            to="/projects/$projectId"
            params={{ projectId: 'LVV-stability' }}
            className="text-link"
          >
            LVV stability, 2–8 °C hold
          </Link>{' '}
          / <span className="mono">Experiments</span>
        </>
      </nav>
    </div>
  )
}

export const breadcrumbTrailPair: ComparisonPair = {
  id: 'breadcrumb-trail',
  title: 'Page location trail',
  job: 'Say where the page is, as a list, with the current crumb marked',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — v3 Breadcrumb (ol/li, hidden separator, aria-current)',
    source: 'src/components/v3/ui/breadcrumb.tsx',
    Column: OurTrailColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — the crumb node 24 files passed to PageHeader',
    source: 'routes/** (as shipped before this change)',
    Column: HandSpelledTrailColumn,
  },
}
