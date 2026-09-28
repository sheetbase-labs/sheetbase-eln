import { Link  } from '@tanstack/react-router'
import type {LinkProps} from '@tanstack/react-router';
import { Input } from '#/components/v3/ui/input'
import { Skeleton } from '#/components/v3/ui/skeleton'
import { cn } from '#/lib/utils'

// Pieces shared by the registry lists (samples, materials, protocols, datasets): a header with the total and actions,
// tabs that live in the `tab` search param, a toolbar with the `q` search box, and a footer count.

const tabCls =
  'inline-flex h-9 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted no-underline hover:text-fg hover:no-underline focus-visible:-outline-offset-2'

export function SearchTabs({
  items,
  current,
  label = 'Filter',
}: {
  items: {
    key: string
    label: string
    count?: React.ReactNode
    link: LinkProps
  }[]
  current: string
  label?: string
}) {
  return (
    <nav aria-label={label} className="flex gap-5 whitespace-nowrap">
      {items.map((t) => (
        <Link
          key={t.key}
          {...t.link}
          className={cn(tabCls, t.key === current && 'border-link text-fg')}
          aria-current={t.key === current ? 'page' : undefined}
          activeOptions={{ exact: true, includeSearch: true }}
        >
          {t.label}
          {t.count != null ? (
            <span className="num text-label font-normal text-fg-muted">
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

export function ListHeader({
  title,
  total,
  actions,
  tabs,
}: {
  title: string
  total?: number
  actions?: React.ReactNode
  tabs?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-1 border-b border-border bg-surface px-4 pt-3 md:px-6 md:pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-title max-md:text-[18px] max-md:leading-6">
          {title}
        </h1>
        {total != null ? (
          <span className="num text-body text-fg-muted">
            {total.toLocaleString('en-GB')}
          </span>
        ) : null}
        <span className="flex-1" />
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2 max-md:w-full max-md:[&>*]:flex-1">
            {actions}
          </div>
        ) : null}
      </div>
      {tabs ? (
        <div className="-mx-4 mt-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          {tabs}
        </div>
      ) : (
        <div className="h-3" />
      )}
    </header>
  )
}

export function ListToolbar({
  q,
  onSearch,
  placeholder,
  label,
  children,
  right,
}: {
  q?: string
  onSearch: (q: string) => void
  placeholder: string
  label: string
  children?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border px-4 py-2 md:px-6">
      {children}
      <label className={cn('block w-full md:w-[260px]', children && 'ml-3')}>
        <span className="sr-only">{label}</span>
        <Input
          type="search"
          placeholder={placeholder}
          defaultValue={q}
          className="h-[26px] text-label max-md:h-10 max-md:text-body"
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <span className="flex-1" />
      {right}
    </div>
  )
}

export function ListFooter({
  children,
  right,
}: {
  children: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-label text-fg-muted max-md:hidden md:px-6">
      <span className="num">{children}</span>
      {right ? (
        <span className="ml-auto text-fg max-xl:mr-28">{right}</span>
      ) : null}
    </div>
  )
}

/** Rows of skeleton for a list's pendingComponent. */
export function ListSkeleton({
  title,
  cols = 6,
  inspector = true,
}: {
  title: string
  cols?: number
  inspector?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1" aria-busy="true">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title={title}
          tabs={
            <div className="flex h-9 items-center gap-5">
              {[80, 50, 140, 80].map((w, i) => (
                <Skeleton key={i} className="h-3" style={{ width: w }} />
              ))}
            </div>
          }
        />
        <div className="flex h-[43px] items-center border-b border-border px-6">
          <Skeleton className="h-[26px] w-[260px]" />
        </div>
        <div className="flex flex-col">
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="flex h-[33px] items-center gap-6 border-b border-border-subtle px-6"
            >
              {Array.from({ length: cols }, (_, j) => (
                <Skeleton
                  key={j}
                  className="h-3"
                  style={{ width: j === 1 ? 200 : 70 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {inspector ? (
        <div className="w-inspector shrink-0 border-l border-border bg-surface p-4">
          <Skeleton className="mb-2 h-3 w-24" />
          <Skeleton className="h-5 w-48" />
        </div>
      ) : null}
    </div>
  )
}

/** A native select in the input's style. Native keeps keyboard and screen reader behaviour for free. */
export function Select({
  className,
  invalid,
  ...props
}: React.ComponentProps<'select'> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        'h-[30px] max-md:h-10 w-full cursor-pointer rounded-md border border-border bg-surface px-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--danger)]',
        className,
      )}
      {...props}
    />
  )
}

/** Textarea in the input's style. */
export function Textarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-body text-fg placeholder:text-fg-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  )
}

/** Phone version of a registry table: stacked rows, each at least 56px, whole row tappable. Pair with `max-md:hidden` on the table. */
export type MobileItem = {
  key: string
  title: React.ReactNode
  id?: string
  sub?: React.ReactNode
  status?: React.ReactNode
  link?: LinkProps
  onSelect?: () => void
  selected?: boolean
}
export function MobileList({
  items,
  label,
}: {
  items: MobileItem[]
  label: string
}) {
  const cls =
    'flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 border-b border-border-subtle bg-transparent px-4 py-2 text-left text-body text-fg no-underline hover:bg-row-hover hover:text-fg hover:no-underline'
  return (
    <ul aria-label={label} className="m-0 list-none p-0 md:hidden">
      {items.map((it) => {
        const inner = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{it.title}</span>
              <span className="truncate text-label text-fg-muted">
                {it.id ? <span className="mono">{it.id}</span> : null}
                {it.id && it.sub ? ' · ' : null}
                {it.sub}
              </span>
            </span>
            {it.status ? (
              <span className="shrink-0 text-label">{it.status}</span>
            ) : null}
            {it.link ? (
              <span className="shrink-0 text-fg-muted" aria-hidden="true">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                >
                  <path d="M6.5 4.5L10 8l-3.5 3.5" />
                </svg>
              </span>
            ) : null}
          </>
        )
        return (
          <li key={it.key}>
            {it.link ? (
              <Link {...it.link} className={cls}>
                {inner}
              </Link>
            ) : (
              <button
                type="button"
                onClick={it.onSelect}
                aria-pressed={it.selected}
                className={cn(cls, it.selected && 'bg-selection')}
              >
                {inner}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Classes for a sticky first column when a table scrolls sideways (tablet). */
export const stickyHead =
  'max-xl:sticky max-xl:left-0 max-xl:z-[1] max-xl:shadow-[1px_0_0_var(--border-subtle)]'
export const stickyCell =
  'max-xl:sticky max-xl:left-0 max-xl:z-[1] max-xl:bg-surface max-xl:shadow-[1px_0_0_var(--border-subtle)]'
