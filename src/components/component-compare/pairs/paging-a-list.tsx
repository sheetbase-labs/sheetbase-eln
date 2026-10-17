import * as React from 'react'

import { Pager } from '#/components/v3/ui/pager'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '#/components/ui/pagination'
import {
  ComparisonEmptyState,
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
} from '#/components/component-compare/types'

/**
 * Pair — paging a list.
 *
 * Ours: `src/components/v3/ui/pager.tsx`, the one pager this change leaves
 * behind. Four project tabs each carried a byte-identical 26-line copy of it
 * before (`projects/$projectId/{experiments,datasets,samples,files}.tsx`), so
 * what this column measures is the surviving control: a `nav` landmark, a range
 * label, and both ends rendered and inert rather than absent.
 *
 * Theirs: the stock shadcn `Pagination*` item — the only pagination on the
 * registry index, because `@reui/pagination` is not an item (the registry
 * 404s; see the comparison record). It lives in `src/components/ui/pagination`
 * — the legacy kit ADR-0055 decision 1 says is not extended — and it is
 * restyled here to Sheetbase tokens, because an adoption would restyle it
 * anyway. Its own model is numbered pages, not a windowed list, so the column
 * renders the nearest thing it can: the numbered item list its story documents.
 *
 * The column is honest about what it cannot do: its `href`s are anchors
 * (`PaginationLink` renders an `<a>`), which is the reason it is not the pager
 * the app can use.
 */

/** Ours: the shipped pager, at the page the fixture can reach. */
function OurPagerColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const pageSize = 25
  const total = rows.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const [page, setPage] = React.useState(1)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-col gap-3" data-comparison-list="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {scenario.state === 'ready' ? (
        <Pager
          page={page}
          pageCount={pageCount}
          start={start}
          end={end}
          total={total}
          noun="rows"
          // The harness has one route, so the pager's own links move the
          // column's page: what is compared is the control, not the screen's
          // routing.
          linkFor={(next) => ({
            to: '/component-compare',
            search: { page: next },
            onClick: () => setPage(next),
          })}
        />
      ) : null}
    </div>
  )
}

/** Theirs: the stock item, restyled to tokens, on the same fixture. */
function StockPaginationColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const total = rows.length
  const pageCount = Math.max(1, Math.ceil(total / 25))
  const [page, setPage] = React.useState(1)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  const numbers = [1, Math.min(page + 1, pageCount), pageCount].filter(
    (value, index, all) => all.indexOf(value) === index,
  )
  return (
    <div className="flex flex-col gap-3" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {rows.length === 0 ? <ComparisonEmptyState /> : null}
      {scenario.state === 'ready' ? (
        <Pagination className="mx-0 w-auto justify-start text-label">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={page <= 1 ? true : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  setPage((p) => Math.max(1, p - 1))
                }}
              />
            </PaginationItem>
            {numbers.map((value) => (
              <PaginationItem key={value}>
                <PaginationLink
                  href="#"
                  isActive={value === page}
                  onClick={(event) => {
                    event.preventDefault()
                    setPage(value)
                  }}
                >
                  {value}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={page >= pageCount ? true : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  setPage((p) => Math.min(pageCount, p + 1))
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
    </div>
  )
}

export const pagingAListPair: ComparisonPair = {
  id: 'paging-a-list',
  title: 'Paging a list',
  job: 'Move between pages of a list, and know which page and rows you are on',
  controls: ['pagination'],
  ours: {
    id: 'ours',
    label: 'Ours — v3 Pager (one control, nav landmark)',
    source: 'src/components/v3/ui/pager.tsx',
    Column: OurPagerColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — stock shadcn Pagination (legacy kit)',
    source: 'src/components/ui/pagination.tsx (registry: not a @reui item)',
    Column: StockPaginationColumn,
  },
}
