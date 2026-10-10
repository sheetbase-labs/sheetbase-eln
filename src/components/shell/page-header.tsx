import * as React from 'react'
import { Link } from '@tanstack/react-router'

import { cn } from '#/lib/utils'

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
            <>
              <Link
                to={breadcrumbs[breadcrumbs.length - 2].to ?? ''}
                className="truncate text-muted-foreground no-underline hover:text-foreground"
              >
                {breadcrumbs[breadcrumbs.length - 2].label}
              </Link>
              <span className="shrink-0 text-muted-foreground/60">/</span>
            </>
          ) : breadcrumbs.length > 1 ? (
            <span className="shrink-0 text-muted-foreground/60">/</span>
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
                <span className="shrink-0 text-muted-foreground/60">/</span>
              ) : null}
              {crumb.to && !last ? (
                <Link
                  to={crumb.to}
                  aria-label={i === 0 ? 'Sheetbase home' : undefined}
                  className="truncate text-muted-foreground no-underline hover:text-foreground"
                >
                  {crumb.label}
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

export interface PageHeaderProps {
  breadcrumbs: AppShellBreadcrumb[]
  title?: React.ReactNode
  status?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
  className?: string
}

/**
 * The v3 page header (SHELL-01.3): breadcrumbs, the routine page title, an
 * optional status line, actions and a tab slot. Routes provide the slots via
 * useShell(); routes that provide none render their own header as before.
 */
export function PageHeader({
  breadcrumbs,
  title,
  status,
  actions,
  tabs,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        'border-b border-border bg-background px-4 pt-3 md:px-6',
        className,
      )}
    >
      <ShellBreadcrumbs breadcrumbs={breadcrumbs} />
      {title || actions ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h1 className="truncate text-page-title text-foreground">
                {title}
              </h1>
            ) : null}
            {status ? (
              <div className="mt-0.5 text-caption text-muted-foreground">
                {status}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {tabs ? <div className="mt-2">{tabs}</div> : null}
    </div>
  )
}
