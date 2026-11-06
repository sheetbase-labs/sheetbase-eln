import { Avatar } from '#/components/ui/avatar'
import type { AvatarSize } from '#/components/ui/avatar'
import { cn } from '#/lib/utils'

/**
 * One person in running text or a table cell: their avatar (photo when they
 * have one, initials otherwise) beside their name. Use it wherever a user is
 * named so a face follows the name on every surface.
 */
export function Person({
  userId,
  name,
  size = 'xs',
  className,
  children,
}: {
  userId?: string | null
  name: string
  size?: AvatarSize
  className?: string
  /** Shown after the name, e.g. a "(you)" tag. */
  children?: React.ReactNode
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar userId={userId} name={name} size={size} aria-hidden />
      <span className="min-w-0 truncate">{name}</span>
      {children}
    </span>
  )
}
