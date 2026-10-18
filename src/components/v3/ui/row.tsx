import { Children, createContext, useContext, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { cn } from '#/lib/utils'

/**
 * Row and RowList — one row, and the list that holds it (JH-1, row chrome).
 *
 * The repository had ≈30 hand-rolled row renderers across 21 files with two
 * competing implementations of the same entity row (`RecordLink` and
 * `LinkedRecordList`): every one of them spelled its own leading slot, title
 * truncation, meta line, trailing slot, hover and focus treatment, and its own
 * branch between a link and a static row. Consolidation is one frame with
 * named slots and one interaction form, so the link and static spellings of a
 * row cannot drift apart.
 *
 * The element a row *is* follows the kit's existing order of preference
 * (`TreeItem` uses the same three): `to` for an internal route, `href` for
 * anything the router does not own, `onClick` for an action that is not
 * navigation, and none of them for a row that is only read. A row that is not
 * a link is not a broken link — it is a row with no interaction, which is how
 * an unavailable record states itself honestly.
 *
 * No Base UI primitive is a list row, so this composes the kit's own token
 * vocabulary rather than a primitive, as `TreeItem`, `Dot` and `Source` do.
 */

const densities = {
  /** Card: a bordered block, for a row that stands on its own. */
  card: {
    row: 'gap-3 rounded-md border border-border bg-surface p-3',
    eyebrow: 'text-xs font-semibold uppercase tracking-wide text-fg-muted',
    title: 'text-sm font-medium',
    meta: 'text-xs text-fg-muted',
  },
  /** List: the compact row inside a panel — 12px title and one muted line. */
  list: {
    row: 'gap-2 rounded-md px-2 py-1.5',
    eyebrow:
      'text-[0.65rem] font-semibold uppercase tracking-wide text-fg-muted',
    title: 'text-xs font-medium',
    meta: 'text-[0.65rem] text-fg-muted',
  },
} as const

export type RowDensity = keyof typeof densities

/** Set by `RowList`, so a row knows it is a list item and how dense it is. */
const RowListContext = createContext<RowDensity | null>(null)

export type RowProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  'title' | 'children' | 'className' | 'onClick'
> & {
  /** `data-*` attributes land on the row element (e.g. a test's marker). */
  [dataAttribute: `data-${string}`]: unknown
  /** Leading slot: an icon tile, an avatar, a dot, a time. */
  leading?: React.ReactNode
  /** Small label above the title — a record type, a column, a heading. */
  eyebrow?: React.ReactNode
  /** The row's identity: one line, truncating. */
  title: React.ReactNode
  /** Second line: an identifier, a reason, a detail. Truncates. */
  meta?: React.ReactNode
  /** Trailing slot: a count, a size, a badge, actions. */
  trailing?: React.ReactNode
  /**
   * Row height and text scale. Set by `RowList` when the row is inside one;
   * a row that stands alone defaults to `list`.
   */
  density?: RowDensity
  /** Internal route. The row becomes a link. */
  to?: string
  /** Anchors the router does not own — downloads, evidence workspaces. */
  href?: string
  /** A row that acts rather than navigates. The row becomes a button. */
  onClick?: () => void
  /**
   * Extra hover detail for the whole row. A native tooltip, not a second
   * line: what the row cannot say without crowding its title.
   */
  detail?: string
  className?: string
}

export function Row({
  leading,
  eyebrow,
  title,
  meta,
  trailing,
  density: densityProp,
  to,
  href,
  onClick,
  detail,
  className,
  ...props
}: RowProps) {
  const inList = useContext(RowListContext)
  const density = densityProp ?? inList ?? 'list'
  const scale = densities[density]
  const interactive =
    to !== undefined || href !== undefined || onClick !== undefined
  const frame = cn(
    'flex w-full items-center text-left',
    scale.row,
    interactive &&
      'cursor-pointer no-underline transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
    className,
  )

  const body = (
    <>
      {leading ? (
        <span className="flex shrink-0 items-center">{leading}</span>
      ) : null}
      <span className="min-w-0 flex-1">
        {eyebrow ? (
          <span className={cn('block truncate', scale.eyebrow)}>{eyebrow}</span>
        ) : null}
        <span className={cn('block truncate', scale.title)}>{title}</span>
        {meta !== undefined && meta !== null ? (
          <span className={cn('block truncate', scale.meta)}>{meta}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-1">{trailing}</span>
      ) : null}
    </>
  )

  // A row inside a RowList carries its tooltip on the list item, so the whole
  // item behaves as one row; a row that stands alone carries it itself.
  const tooltip = inList === null ? detail : undefined
  const element = to ? (
    <Link to={to as never} className={frame} title={tooltip} {...props}>
      {body}
    </Link>
  ) : href ? (
    <a href={href} className={frame} title={tooltip} {...props}>
      {body}
    </a>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={frame}
      title={tooltip}
      {...props}
    >
      {body}
    </button>
  ) : (
    <div className={frame} title={tooltip} {...props}>
      {body}
    </div>
  )

  return inList === null ? element : <li title={detail}>{element}</li>
}

export type RowListProps = Omit<React.ComponentProps<'ul'>, 'children'> & {
  /** Passed to every row: card or compact list row. */
  density?: RowDensity
  /** Hairlines between rows, for a list that reads as a table. */
  divided?: boolean
  /** What the list says instead of rows when it has none. */
  empty?: React.ReactNode
  /**
   * Render this many rows and offer the rest behind "Show all N" — the
   * window that heavy lists use so a 100-edge record still renders quickly.
   */
  limit?: number
  children?: React.ReactNode
}

export function RowList({
  density = 'list',
  divided = false,
  empty,
  limit,
  className,
  children,
  ...props
}: RowListProps) {
  const [expanded, setExpanded] = useState(false)
  const items = Children.toArray(children)

  if (items.length === 0) return empty === undefined ? null : <>{empty}</>

  const windowed = limit !== undefined && !expanded && items.length > limit
  const shown = windowed ? items.slice(0, limit) : items

  return (
    <>
      <RowListContext.Provider value={density}>
        <ul
          className={cn(
            'm-0 flex list-none flex-col p-0',
            divided ? 'divide-y divide-border-subtle' : 'gap-1',
            className,
          )}
          {...props}
        >
          {shown}
        </ul>
      </RowListContext.Provider>
      {windowed ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 px-1 text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          Show all {items.length}
        </button>
      ) : null}
    </>
  )
}
