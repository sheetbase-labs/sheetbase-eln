import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Folders inside a project. Two levels at most; the current folder gets aria-current like the main navigation.
export function Tree({
  label = 'Folders',
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <nav aria-label={label} className={cn('flex flex-col gap-px', className)}>
      {children}
    </nav>
  )
}

export function TreeItem({
  depth = 0,
  current,
  count,
  icon = 'folder',
  link,
  onClick,
  children,
}: {
  depth?: 0 | 1
  current?: boolean
  count?: React.ReactNode
  icon?: IconName
  link?: LinkProps
  onClick?: () => void
  children: React.ReactNode
}) {
  const cls = cn(
    'flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent pr-2 text-left text-body text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline [&_svg]:text-fg-muted',
    current && 'bg-selection font-medium hover:bg-selection',
  )
  const inner = (
    <>
      <Icon name={icon} size={14} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null ? (
        <span className="text-label font-normal text-fg-muted">{count}</span>
      ) : null}
    </>
  )
  const style = { paddingLeft: 8 + depth * 16 }
  return link ? (
    <Link
      {...link}
      className={cls}
      style={style}
      aria-current={current ? 'page' : undefined}
    >
      {inner}
    </Link>
  ) : (
    <button
      type="button"
      onClick={onClick}
      className={cls}
      style={style}
      aria-current={current ? 'page' : undefined}
    >
      {inner}
    </button>
  )
}
