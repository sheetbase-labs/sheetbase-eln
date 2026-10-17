import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'

import { cn } from '#/lib/utils'

/**
 * The foot of a paged list: the rows on screen and the two ways off this page.
 *
 * It is a `nav` landmark because that is what it is, and it says so
 * (`aria-label="Pagination"`). Both controls are rendered on every page and
 * disabled at the ends — a page-1 footer used to omit "Previous" altogether, so
 * the row moved and a reader could not tell a first page from a missing control.
 *
 * The arithmetic is the caller's: the page size, the page parse and the range
 * are one owner's policy (`src/components/v3/projects/project-lists.ts`), and
 * this renders what that produced.
 */
export function Pager({
  page,
  pageCount,
  start,
  end,
  total,
  noun,
  linkFor,
}: {
  /** 1-based page on screen. */
  page: number
  pageCount: number
  /** First and last row shown on this page, as the range label prints them. */
  start: number
  end: number
  total: number
  /** What is counted, plural: "experiments". */
  noun: string
  /** The same list at another page. */
  linkFor: (page: number) => LinkProps
}) {
  // The appearance is the pager's own: the router's `Link` drops the `href` and
  // marks itself `aria-disabled`, but a screen that renders this outside that
  // router (a story, a harness column) still has to show which end it is at.
  const linkClass = (disabled: boolean) =>
    cn('text-link', disabled && 'text-fg-faint')
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3">
      <span>
        Showing {start}–{end} of {total} {noun}
      </span>
      <Link
        {...linkFor(Math.max(1, page - 1))}
        disabled={page <= 1}
        className={linkClass(page <= 1)}
      >
        Previous
      </Link>
      <Link
        {...linkFor(Math.min(pageCount, page + 1))}
        disabled={page >= pageCount}
        className={linkClass(page >= pageCount)}
      >
        Next
      </Link>
    </nav>
  )
}
