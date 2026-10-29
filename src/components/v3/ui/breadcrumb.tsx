import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'

import { cn } from '#/lib/utils'
import { t } from '#/copy'

/**
 * One step of a page's location.
 *
 * A trail is data, not markup, so every screen's crumbs read the same in the
 * accessibility tree: an `ol` of `li`s, the separator hidden from it, and
 * `aria-current="page"` on the crumb you are standing on. Screens used to spell
 * that line themselves — 12 of them with their own `/` text node, which a
 * screen reader read as content rather than as punctuation.
 */
export type Crumb = {
  label: React.ReactNode
  /** Where this crumb goes. Omit it on the crumb you are on. */
  link?: LinkProps
  /** Identifiers are set in the mono face. */
  mono?: boolean
}

/**
 * The trail at the top of a page, and the same element `PageHeader` renders for
 * its `trail` prop.
 *
 * It owns its own `nav` so a screen that composes its own header (the help
 * articles) can use it without taking the rest of `PageHeader`.
 */
export function Breadcrumb({
  trail,
  className,
}: {
  trail: readonly Crumb[]
  className?: string
}) {
  return (
    <nav
      aria-label={t('settings.uiKit.breadcrumb.breadcrumbAria')}
      className={cn('min-w-0 text-[13px] leading-5 text-fg-muted', className)}
    >
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-0.5 p-0">
        {trail.map((crumb, index) => (
          <li
            key={index}
            className="flex min-w-0 items-center gap-1.5"
            aria-current={
              index === trail.length - 1 && !crumb.link ? 'page' : undefined
            }
          >
            {index > 0 ? (
              <span aria-hidden="true" className="text-fg-faint">
                ›
              </span>
            ) : null}
            {crumb.link ? (
              <Link
                {...crumb.link}
                className={cn('text-link', crumb.mono && 'mono')}
                // A parent crumb must not claim the page: the router marks a
                // link active on a path *prefix* by default, so `/samples`
                // would carry `aria-current="page"` on `/samples/SMP-2025-0001`
                // and the trail would name two current pages.
                activeOptions={{ exact: true }}
              >
                {crumb.label}
              </Link>
            ) : (
              <span className={cn('text-fg', crumb.mono && 'mono')}>
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
