import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Home as HomeIcon } from 'lucide-react'

import type { AppShellBreadcrumb } from './shell-context'

/**
 * Shell breadcrumbs (SHELL-01). Narrow screens keep the canonical parent and
 * current location visible; desktop shows the complete hierarchy.
 */
export function ShellBreadcrumbs({
  breadcrumbs,
}: {
  breadcrumbs: AppShellBreadcrumb[]
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-sm"
    >
      {breadcrumbs.length > 0 ? (
        <span
          className="flex min-w-0 items-center gap-2 sm:hidden"
          data-slot="mobile-breadcrumb"
        >
          {breadcrumbs.length > 1 && breadcrumbs[breadcrumbs.length - 2]?.to ? (
            <Link
              to={breadcrumbs[breadcrumbs.length - 2].to ?? ''}
              className="inline-flex items-center gap-1 text-muted-foreground no-underline hover:text-foreground"
            >
              <ChevronRight className="size-3.5 shrink-0 rotate-180 text-muted-foreground/60" />
              <span className="truncate">
                {breadcrumbs[breadcrumbs.length - 2].label}
              </span>
            </Link>
          ) : breadcrumbs.length > 1 ? (
            <ChevronRight className="size-3.5 shrink-0 rotate-180 text-muted-foreground/60" />
          ) : null}
          {breadcrumbs.length > 1 ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
          ) : null}
          <span
            className="truncate font-medium text-foreground"
            aria-current="page"
          >
            {breadcrumbs[breadcrumbs.length - 1].label}
          </span>
        </span>
      ) : null}
      <span className="hidden min-w-0 items-center gap-2 sm:flex">
        {breadcrumbs.map((crumb, i) => {
          const last = i === breadcrumbs.length - 1
          return (
            <React.Fragment key={`${crumb.label}-${i}`}>
              {i > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
              ) : null}
              {crumb.to && !last ? (
                <Link
                  to={crumb.to}
                  aria-label={i === 0 ? 'Sheetbase home' : undefined}
                  className="truncate text-muted-foreground no-underline hover:text-foreground"
                >
                  {i === 0 && crumb.to === '/' ? (
                    <HomeIcon className="size-3.5 shrink-0" />
                  ) : (
                    crumb.label
                  )}
                </Link>
              ) : (
                <span
                  className="truncate font-medium text-foreground"
                  aria-current={last ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          )
        })}
      </span>
    </nav>
  )
}
