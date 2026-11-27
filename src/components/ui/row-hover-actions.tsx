import { Button } from './button'
import { Tooltip } from './tooltip'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

/**
 * A list row's quick actions, set at the end of a cell and shown while the
 * pointer is over the row or focus is inside it. Where a pointer can't hover
 * (a phone) they stay out of the way and the row opens as usual.
 */
export function RowHoverActions({
  children,
  actions,
  className,
}: {
  /** The cell's own content, which keeps its place. */
  children: React.ReactNode
  actions: React.ReactNode
  className?: string
}) {
  return (
    <span
      data-row-actions
      className={cn('flex min-h-6 min-w-0 items-center gap-2', className)}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {/* Clicks here are the actions', not the row's. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- only stops the row's own click; the buttons inside are the interactive elements. */}
      <span
        className="pointer-events-none flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 ease-out pointer-coarse:hidden pointer-fine:in-[tr:hover]:pointer-events-auto pointer-fine:in-[tr:hover]:opacity-100 in-[tr:focus-within]:pointer-events-auto in-[tr:focus-within]:opacity-100"
        onClick={(event) => event.stopPropagation()}
      >
        {actions}
      </span>
    </span>
  )
}

/** One quiet icon button in a row's hover actions, named by its tooltip. */
export function RowAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip content={label}>
      <Button
        variant="quiet"
        size="icon"
        icon={icon}
        aria-label={label}
        className="size-6 text-fg-muted hover:bg-surface hover:text-fg max-md:size-6"
        onClick={onClick}
      />
    </Tooltip>
  )
}
