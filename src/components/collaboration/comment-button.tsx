import { Icon } from '#/components/icons'
import { Badge } from '#/components/v3/ui/badge'
import { Button } from '#/components/v3/ui/button'
import { cn } from '#/lib/utils'

/**
 * COLLAB-02 comment affordance: a compact ghost icon button with an
 * unresolved-comment count badge. Used by notebook blocks, sheet selections
 * and inspector headers to open a ThreadPanel.
 */
export function CommentButton({
  count = 0,
  label = 'Comments',
  onClick,
  className,
}: {
  /** Number of unresolved comments to surface on the badge. */
  count?: number
  /** Accessible name; callers should qualify it (e.g. "Comments on block"). */
  label?: string
  onClick?: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="quiet"
      size="icon"
      aria-label={label}
      className={cn('relative', className)}
      onClick={onClick}
    >
      <Icon name="comment" className="size-3.5" aria-hidden="true" />
      {count > 0 ? (
        <Badge
          className="absolute -right-1.5 -top-1.5 h-3.5 min-w-3.5 px-0.5 text-[9px] leading-none"
          aria-hidden="true"
        >
          {count > 9 ? '9+' : count}
        </Badge>
      ) : null}
    </Button>
  )
}
