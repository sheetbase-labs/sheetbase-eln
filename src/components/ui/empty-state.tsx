import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

/**
 * The one empty state.
 *
 * `DESIGN.md` (Application states): an empty state explains what is absent and
 * offers one relevant next action. This is the only component that renders
 * one — the legacy kit's `ui/empty.tsx` (no product call site) and this file's
 * 37-line predecessor, which had nowhere to put an action, were both removed
 * by the change that added `description` and `action` below.
 *
 * `description` says what would fill the space and `action` carries the one
 * next step (a `Button`, usually). The deprecated `body` alias that carried the
 * description through the migration is gone: every site passes `description`
 * now, and `docs/knowledge/design/empty-state-migration.md` records the sweep.
 *
 * The anatomy follows the shadcn `empty` item (`EmptyHeader`, `EmptyMedia`,
 * `EmptyTitle`, `EmptyDescription`, `EmptyContent`), restated as the props the
 * product's sites already use and placed where the rows would be rather than
 * centred in the window (design system, EmptyState). The comparison against the
 * item, and the decision, are in
 * `docs/knowledge/design/component-comparison-record.md`.
 */
export function EmptyState({
  icon,
  media,
  title,
  description,
  action,
  children,
  nested = false,
  className,
}: {
  /** The standard leading icon. Ignored when `media` is given. */
  icon?: IconName
  /** A custom leading visual, for the rare case an icon does not fit. */
  media?: React.ReactNode
  title: React.ReactNode
  /** What is absent, and what would fill it. */
  description?: React.ReactNode
  /** The one relevant next action. */
  action?: React.ReactNode
  /** Anything else below the action row. */
  children?: React.ReactNode
  /**
   * The empty state sits inside a section that already has its own heading
   * (a table's empty body under "Starts on"): a dashed outline where the rows
   * would be, a component-size title one level down, and no second page-sized
   * heading competing with the section's.
   */
  nested?: boolean
  className?: string
}) {
  const Title = nested ? 'h3' : 'h2'

  return (
    <div
      className={cn(
        'flex flex-col items-start gap-2',
        nested
          ? 'rounded-md border border-dashed border-border-strong px-4 py-4'
          : 'py-8',
        className,
      )}
    >
      {media ? (
        media
      ) : icon ? (
        <span className="text-fg-muted">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <Title className={nested ? 'text-body font-semibold' : 'text-section'}>
        {title}
      </Title>
      {description ? (
        <p className="m-0 text-caption text-fg-muted">{description}</p>
      ) : null}
      {action || children ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {action}
          {children}
        </div>
      ) : null}
    </div>
  )
}
