import { Avatar } from '#/components/ui/avatar'
import type { AvatarSize } from '#/components/ui/avatar'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/**
 * One person in running text or a table cell: their avatar (photo when they
 * have one, initials otherwise) beside their name. Use it wherever a user is
 * named so a face follows the name on every surface. Pass `you` when the
 * person is the reader: the face stays theirs and the name reads "You".
 */
export function Person({
  userId,
  name,
  size = 'xs',
  you = false,
  className,
  children,
}: {
  userId?: string | null
  /** Their real name, which also gives the avatar its initials. */
  name: string
  /** The person is the reader: say "You" beside their own face. */
  you?: boolean
  size?: AvatarSize
  className?: string
  /** Shown after the name, e.g. a "(you)" tag. */
  children?: React.ReactNode
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar userId={userId} name={name} size={size} aria-hidden />
      <span className="min-w-0 truncate">
        {you ? t('common.people.you') : name}
      </span>
      {children}
    </span>
  )
}
