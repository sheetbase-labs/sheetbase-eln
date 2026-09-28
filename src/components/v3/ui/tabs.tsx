import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { cn } from '#/lib/utils'

const tabCls =
  'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted no-underline hover:text-fg hover:no-underline focus-visible:-outline-offset-2'

// In-page tabs (state). Use RouteTabs when each tab is its own URL.
export const Tabs = TabsPrimitive.Root
export const TabsPanel = TabsPrimitive.Panel
export function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex gap-5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]',
        className,
      )}
      {...props}
    />
  )
}
export function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        tabCls,
        'data-active:border-link data-active:text-fg',
        className,
      )}
      {...props}
    />
  )
}

/** Tabs that are routes: each one is a Link, the current one gets aria-current. */
export function RouteTabs({
  tabs,
  className,
}: {
  tabs: { label: React.ReactNode; count?: React.ReactNode; link: LinkProps }[]
  className?: string
}) {
  return (
    <nav
      aria-label="Sections"
      className={cn('flex gap-5 whitespace-nowrap', className)}
    >
      {tabs.map((t, i) => (
        <Link
          key={i}
          {...t.link}
          className={tabCls}
          activeProps={{
            className: 'border-link! text-fg!',
            'aria-current': 'page',
          }}
          activeOptions={{ exact: false, includeSearch: false }}
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
