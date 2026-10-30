import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { cn } from '#/lib/utils'

/**
 * The tab family — one contract, two modes.
 *
 * Before this module the job was done six times: two differently shaped
 * `SearchTabs` (one in `v3/inventory/list.tsx`, one in
 * `v3/projects/search-tabs.tsx` repeating the same class literal character for
 * character), a `RouteTabs` with no consumers, `LinkTabs`, `SegmentLinks` and
 * the Base UI parts themselves — and six routes hand-rolled the strip anyway.
 * The same "which view am I looking at" affordance therefore announced itself
 * three ways: `role="tablist"`/`role="tab"` with no keyboard path at all,
 * `role="group"` with `aria-pressed`, and a `<nav>` of links.
 *
 * The two modes are the two jobs:
 *
 * - **`mode="state"`** — the tabs change what is shown in place. A real
 *   tablist: `role="tablist"` / `role="tab"`, roving focus, ArrowLeft and
 *   ArrowRight with Home/End at the ends (Up/Down are not part of a horizontal
 *   tablist — they belong to a vertical one, and to the browser's scrolling),
 *   `aria-selected`, and activation that follows focus — the APG's
 *   recommendation when the panels are cheap, and what the Inbox has shipped
 *   since QA3-inbox-3. `aria-controls` is wired to a `TabsPanel` when one is
 *   rendered, and omitted when the route renders its own content (a dangling
 *   `aria-controls` is an axe violation).
 * - **`mode="url"`** — each tab is its own URL. A `<nav>` of links: Tab reaches
 *   each one, Enter follows it, and the current tab carries
 *   `aria-current="page"`. No `aria-selected` and no roving focus here, on
 *   purpose: a link is navigation, not an in-page tab, and the arrow-key
 *   contract belongs to the tablist. `aria-selected` on a link is not a valid
 *   announcement — it is what made the hand-rolled strips lie to a screen
 *   reader.
 *
 * Both modes take the same `items` (`key`, `label`, `count`), the same
 * accessible `label` and the same `variant`, so a strip's appearance and its
 * announcement are decided once, here, rather than by the screen that renders
 * it.
 *
 * `TabsRoot`, `TabsList`, `TabsTab` and `TabsPanel` are the Base UI parts,
 * exported for the two consumers that compose panels with their own chrome
 * interleaved (the record and notebook inspectors). They are the same parts
 * `Tabs` renders; they are not a second implementation.
 */

/** One tab. `link` is required in URL mode and unused in state mode. */
export interface TabItem {
  /**
   * The key `value` is matched against, and React's key for the item. Required
   * in state mode, where it is the tab's value. Optional in URL mode: a strip
   * whose tabs are distinct paths is identified by those paths, so only a strip
   * whose tabs share one path (a `?tab=` list) needs to name them.
   */
  key?: string
  label: React.ReactNode
  /** Trailing count; nothing is rendered when it is undefined. */
  count?: React.ReactNode
  link?: LinkProps
}

/**
 * How a strip is drawn: `strip` is the section row that sits under a page
 * header, `segment` a compact "one of N" control inside a toolbar, and `chip`
 * the rounded pill row the phone layouts scroll sideways.
 */
export type TabVariant = 'strip' | 'segment' | 'chip'

const ITEM: Record<TabVariant, string> = {
  // The focus outline is drawn inside the item (`-outline-offset-2`): a strip
  // scrolls sideways in its rail, and an outer ring would be clipped by it.
  strip:
    'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted no-underline hover:text-fg hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus max-md:h-11',
  segment:
    'inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-label font-medium text-fg-muted no-underline hover:text-fg hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus max-md:h-8',
  chip: 'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 text-label text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus max-md:h-9',
}

/**
 * The current tab's tokens. Written out twice, unprefixed for a link and
 * prefixed for a tab's `data-active`: Tailwind reads the class names as text in
 * this file, so a name composed at runtime (`data-active:${token}`) is a name it
 * never generates — the strip then renders with no active state at all.
 */
const ACTIVE: Record<TabVariant, string> = {
  strip: 'border-link text-fg',
  segment: 'bg-surface text-fg shadow-[0_0_0_1px_var(--border)]',
  chip: 'border-selection-border bg-selection font-medium hover:bg-selection',
}

const ACTIVE_DATA: Record<TabVariant, string> = {
  strip: 'data-active:border-link data-active:text-fg',
  segment:
    'data-active:bg-surface data-active:text-fg data-active:shadow-[0_0_0_1px_var(--border)]',
  chip: 'data-active:border-selection-border data-active:bg-selection data-active:font-medium data-active:hover:bg-selection',
}

/** The strip's own container: the rail for `strip` and `chip`, the control body for `segment`. */
const LIST: Record<TabVariant, string> = {
  strip: 'flex gap-5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]',
  segment:
    'flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-md border border-border bg-surface-muted p-0.5 [scrollbar-width:none]',
  chip: 'flex items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]',
}

function TabCount({ count }: { count?: React.ReactNode }) {
  if (count == null) return null
  // The space is explicit: without it the tab's accessible name runs the label
  // and the count together ("All4"), which is what a screen reader reads out.
  return (
    <>
      {' '}
      <span className="num text-label font-normal text-fg-muted">{count}</span>
    </>
  )
}

export const TabsRoot = TabsPrimitive.Root
export const TabsPanel = TabsPrimitive.Panel

export function TabsList({
  variant = 'strip',
  className,
  ...props
}: TabsPrimitive.List.Props & { variant?: TabVariant }) {
  return (
    <TabsPrimitive.List
      // Arrow keys select as they move focus, for both modes' consumers: the
      // panels are cheap in-page content, which is the case the APG recommends
      // automatic activation for.
      activateOnFocus
      className={cn(LIST[variant], className)}
      {...props}
    />
  )
}

export function TabsTab({
  variant = 'strip',
  className,
  ...props
}: TabsPrimitive.Tab.Props & { variant?: TabVariant }) {
  return (
    <TabsPrimitive.Tab
      className={cn(ITEM[variant], ACTIVE_DATA[variant], className)}
      {...props}
    />
  )
}

export type TabsProps =
  | {
      mode: 'state'
      items: readonly (TabItem & { key: string })[]
      /** The key of the tab whose content is shown. */
      value: string
      onValueChange: (key: string) => void
      /** The tab list's accessible name. */
      label: string
      variant?: TabVariant
      className?: string
    }
  | {
      mode: 'url'
      items: readonly (TabItem & { link: LinkProps })[]
      /**
       * The key of the tab the current URL shows. Omit it when each tab's own
       * path identifies it: the router decides then, and the item's
       * `link.activeOptions` still applies (an index tab passes `exact`, so it
       * is not also current under its own children). Pass it when several tabs
       * share one path and differ by a search parameter the link does not
       * repeat in full — a list filtered by `?tab=`, where nothing in the URL
       * matching alone can tell the tabs apart.
       */
      value?: string
      /** The nav's accessible name. */
      label: string
      variant?: TabVariant
      className?: string
    }

/** The tab strip: `mode="state"` for in-page tabs, `mode="url"` for tabs that are routes. */
export function Tabs(props: TabsProps) {
  return props.mode === 'url' ? (
    <UrlTabs {...props} />
  ) : (
    <StateTabs {...props} />
  )
}

function StateTabs({
  label,
  items,
  value,
  onValueChange,
  variant = 'strip',
  className,
}: Extract<TabsProps, { mode: 'state' }>) {
  return (
    <TabsRoot
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      className="flex min-w-0 flex-col"
    >
      <TabsList variant={variant} aria-label={label} className={className}>
        {items.map((item) => (
          <TabsTab key={item.key} value={item.key} variant={variant}>
            {item.label}
            <TabCount count={item.count} />
          </TabsTab>
        ))}
      </TabsList>
    </TabsRoot>
  )
}

function UrlTabs({
  label,
  items,
  value,
  variant = 'strip',
  className,
}: Extract<TabsProps, { mode: 'url' }>) {
  return (
    <nav aria-label={label} className={cn(LIST[variant], className)}>
      {items.map((item, index) => {
        const current = value === undefined ? undefined : item.key === value
        return (
          <Link
            key={item.key ?? item.link.to ?? index}
            {...item.link}
            aria-current={current ? 'page' : undefined}
            className={cn(ITEM[variant], current && ACTIVE[variant])}
            // Where the caller names the current key, only that key is current:
            // the router's own match is narrowed to the same URL, so its
            // `aria-current` can never disagree with the key. Without a key the
            // router's match is the only rule there is (a path per tab), and the
            // search is left out of it — a filter in the query string must not
            // unhighlight the section you are standing in.
            activeProps={{ className: ACTIVE[variant] }}
            activeOptions={{
              exact: value !== undefined,
              includeSearch: value !== undefined,
              ...item.link.activeOptions,
            }}
          >
            {item.label}
            <TabCount count={item.count} />
          </Link>
        )
      })}
    </nav>
  )
}
