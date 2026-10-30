import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Phone version of a primary list: stacked rows (≥56px), title + one muted line + status, whole row tappable.
// Render next to the table: <MobileList className="md:hidden" …/> and give the table `max-md:hidden`.
export type MobileRow = {
  key: string
  title: React.ReactNode
  meta?: React.ReactNode
  status?: { tone: Tone; label: string }
  link?: LinkProps
  onClick?: () => void
  selected?: boolean
}

export function MobileList({
  rows,
  label,
  className,
}: {
  rows: MobileRow[]
  label: string
  className?: string
}) {
  return (
    <ul aria-label={label} className={cn('m-0 list-none p-0', className)}>
      {rows.map((r) => {
        const inner = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="line-clamp-2 break-words text-body font-medium text-fg">
                {r.title}
              </span>
              {r.meta ? (
                <span className="truncate text-label text-fg-muted">
                  {r.meta}
                </span>
              ) : null}
            </span>
            {r.status ? (
              <span className="shrink-0 text-label">
                <Status tone={r.status.tone}>{r.status.label}</Status>
              </span>
            ) : null}
            {r.link ? (
              <Icon
                name="chevronRight"
                size={14}
                className="shrink-0 text-fg-muted"
              />
            ) : null}
          </>
        )
        const cls = cn(
          'flex min-h-14 w-full items-center gap-3 border-0 border-b border-border-subtle bg-transparent px-4 py-2 text-left text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline',
          r.selected && 'bg-selection',
        )
        return (
          <li key={r.key}>
            {r.link ? (
              <Link {...r.link} className={cls}>
                {inner}
              </Link>
            ) : (
              <button
                type="button"
                className={cn(cls, 'cursor-pointer font-[inherit]')}
                aria-pressed={r.selected}
                onClick={r.onClick}
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

/** Sticky first column for tables that scroll sideways below desktop width. */
export const stickyCol =
  'max-xl:sticky max-xl:left-0 max-xl:z-[1] max-xl:bg-surface max-xl:shadow-[1px_0_0_var(--border-subtle)]'
/** Same, applied to whichever cell is first in its row (for header/cell helpers). */
export const stickyFirstCell =
  'max-xl:first:sticky max-xl:first:left-0 max-xl:first:z-[1] max-xl:first:bg-surface max-xl:first:shadow-[1px_0_0_var(--border-subtle)]'
export const stickyFirstHead =
  'max-xl:first:sticky max-xl:first:left-0 max-xl:first:z-[1] max-xl:first:bg-surface-muted max-xl:first:shadow-[1px_0_0_var(--border-subtle)]'
