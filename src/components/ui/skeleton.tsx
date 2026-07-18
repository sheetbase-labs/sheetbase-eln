import { cn } from '#/lib/utils'

/**
 * Skeleton — a non-communicating placeholder shimmer. Used by loading
 * states (Inspector, record headers, tables) so the layout is stable while
 * real data arrives. Pulse only; never communicates a value.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}
