import type { ReactNode } from 'react'

import { Icon } from '#/components/icons'
import { cn } from '#/lib/utils'

/**
 * Filter chip (DSYS-04): a removable value in a filter row. The remove
 * button always has a named accessible label, defaulting to "Remove".
 */
export interface ChipProps {
  children: ReactNode
  onRemove?: () => void
  removeLabel?: string
  className?: string
}

export function Chip({
  children,
  onRemove,
  removeLabel = 'Remove',
  className,
}: ChipProps) {
  return (
    <span
      data-slot="chip"
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-card pr-1 pl-2 text-caption',
        className,
      )}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="x" size={10} />
        </button>
      ) : null}
    </span>
  )
}
