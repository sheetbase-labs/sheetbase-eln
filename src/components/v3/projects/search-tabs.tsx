import { Link  } from '@tanstack/react-router'
import type {LinkProps} from '@tanstack/react-router';
import { cn } from '#/lib/utils'

const tabCls =
  'inline-flex h-9 shrink-0 whitespace-nowrap cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted no-underline hover:text-fg hover:no-underline focus-visible:-outline-offset-2'

/** List tabs kept in the URL (?tab=…): each tab is a Link on the same path, the current one gets aria-current. */
export function SearchTabs({
  tabs,
  label = 'Views',
  className,
}: {
  tabs: {
    key: string
    label: React.ReactNode
    count?: React.ReactNode
    link: LinkProps
    active: boolean
  }[]
  label?: string
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn('flex gap-5', className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          {...t.link}
          aria-current={t.active ? 'page' : undefined}
          className={cn(tabCls, t.active && 'border-link text-fg')}
        >
          {t.label}
          {t.count != null ? (
            <span className="text-label font-normal text-fg-muted">
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

/** Segmented control for a small set of filters kept in the URL. */
export function SegmentLinks({
  items,
  label,
}: {
  items: {
    key: string
    label: React.ReactNode
    count?: React.ReactNode
    link: LinkProps
    active: boolean
  }[]
  label: string
}) {
  return (
    <nav
      aria-label={label}
      className="flex gap-0.5 rounded-md border border-border bg-surface-muted p-0.5"
    >
      {items.map((i) => (
        <Link
          key={i.key}
          {...i.link}
          aria-current={i.active ? 'true' : undefined}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-label font-medium text-fg-muted no-underline hover:text-fg hover:no-underline',
            i.active && 'bg-surface text-fg shadow-[0_0_0_1px_var(--border)]',
          )}
        >
          {i.label}
          {i.count != null ? (
            <span className="num font-normal text-fg-muted">{i.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

/** Like RouteTabs, but a tab can pass its own activeOptions (e.g. exact for an index tab). */
export function LinkTabs({
  tabs,
  className,
}: {
  tabs: { label: React.ReactNode; count?: React.ReactNode; link: LinkProps }[]
  className?: string
}) {
  return (
    <nav aria-label="Sections" className={cn('flex gap-5', className)}>
      {tabs.map((t, i) => (
        <Link
          key={i}
          {...t.link}
          className={tabCls}
          activeProps={{
            className: 'border-link! text-fg!',
            'aria-current': 'page',
          }}
          activeOptions={{
            exact: false,
            includeSearch: false,
            ...t.link.activeOptions,
          }}
        >
          {t.label}
          {t.count != null ? (
            <span className="text-label font-normal text-fg-muted">
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
