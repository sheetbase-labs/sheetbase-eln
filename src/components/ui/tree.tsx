import * as React from 'react'

import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

/**
 * Tree and TreeItem (DSYS-04): a two-level folder tree. The tree handles
 * arrow-key navigation (↑/↓ move, →/← move between parent and child) on the
 * items, and the current item is marked with `aria-current="page"`.
 */
export function Tree({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowLeft'
    )
      return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    )
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (index === -1) return
    const depthOf = (item: HTMLElement) => Number(item.dataset.depth ?? '0')
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1)
    if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    if (event.key === 'ArrowRight') {
      const child = items.findIndex(
        (item, i) => i > index && depthOf(item) > depthOf(items[index]),
      )
      if (child !== -1) next = child
    }
    if (event.key === 'ArrowLeft') {
      const parent = items
        .map((item, i) => ({ item, i }))
        .reverse()
        .find(
          ({ item, i }) => i < index && depthOf(item) < depthOf(items[index]),
        )
      if (parent) next = parent.i
    }
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <div
      role="tree"
      data-slot="tree"
      onKeyDown={onKeyDown}
      className={cn('flex flex-col gap-px', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export interface TreeItemProps {
  depth?: number
  current?: boolean
  icon?: IconName
  count?: string | number
  href?: string
  onClick?: () => void
  className?: string
  children: React.ReactNode
}

export function TreeItem({
  depth = 0,
  current,
  icon,
  count,
  href,
  onClick,
  className,
  children,
}: TreeItemProps) {
  const classes = cn(
    'flex h-7 items-center gap-1.5 rounded-md pr-2 text-left text-body outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
    current && 'bg-selection font-medium',
    className,
  )
  const style = { paddingLeft: 8 + depth * 14 }
  const content = (
    <>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null ? (
        <span className="text-caption text-muted-foreground">{count}</span>
      ) : null}
    </>
  )
  const common = {
    role: 'treeitem' as const,
    'data-slot': 'tree-item',
    'data-depth': depth,
    'aria-current': current ? ('page' as const) : undefined,
    tabIndex: current ? 0 : -1,
    className: classes,
    style,
  }

  if (href) {
    return (
      <a href={href} onClick={onClick} {...common}>
        {content}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} {...common}>
      {content}
    </button>
  )
}
