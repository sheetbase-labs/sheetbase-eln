import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
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
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex max-w-[440px] flex-col items-start gap-2 py-8',
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
      <h2 className="text-section">{title}</h2>
      {description ? (
        <p className="m-0 text-body leading-5 text-fg-muted">{description}</p>
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
