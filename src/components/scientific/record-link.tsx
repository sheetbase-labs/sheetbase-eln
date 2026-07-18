import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, FileWarning, Link2, Lock, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

/**
 * RecordLink — a relationship to another record (used in inspectors, lists
 * and "linked records" sections). It is a real link when the target exists
 * and the viewer can reach it, and an honest, non-interactive row when it
 * does not.
 *
 * States (UI-005): available, missing (target not found), deleted (soft-
 * deleted), permission-restricted (viewer lacks access). Each non-available
 * state explains itself in text and never renders a link. Auxiliary actions
 * (open, unlink, etc.) are preserved and stay keyboard-operable.
 */

export type RecordLinkState =
  'available' | 'missing' | 'deleted' | 'permission-restricted'

export interface RecordLinkProps {
  /** Internal path. Required for `available`; ignored for other states. */
  to?: string
  /** Record kind, e.g. "Sample", "Protocol". */
  type: string
  title: string
  meta?: string
  icon?: LucideIcon
  state?: RecordLinkState
  /** Auxiliary actions rendered at the right edge (buttons/links). */
  actions?: React.ReactNode
  className?: string
}

const stateMeta: Record<
  Exclude<RecordLinkState, 'available'>,
  { icon: LucideIcon; label: string; className: string }
> = {
  missing: {
    icon: FileWarning,
    label: 'Unavailable',
    className: 'text-muted-foreground',
  },
  deleted: {
    icon: Trash2,
    label: 'Deleted',
    className: 'text-muted-foreground line-through',
  },
  'permission-restricted': {
    icon: Lock,
    label: 'Permission restricted',
    className: 'text-muted-foreground',
  },
}

export function RecordLink({
  to,
  type,
  title,
  meta,
  icon: Icon = Link2,
  state = 'available',
  actions,
  className,
}: RecordLinkProps) {
  const unavailable = state !== 'available'
  const stateInfo = unavailable ? stateMeta[state] : null
  const StateIcon = stateInfo?.icon

  const body = (
    <>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          unavailable
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary/10 text-primary',
        )}
      >
        {StateIcon ? (
          <StateIcon className="size-4" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {type}
        </span>
        <span
          className={cn(
            'block truncate text-sm font-medium',
            stateInfo?.className,
          )}
        >
          {title}
        </span>
        {meta || stateInfo ? (
          <span className="block truncate text-xs text-muted-foreground">
            {stateInfo ? stateInfo.label : meta}
          </span>
        ) : null}
      </span>
    </>
  )

  const actionNode = actions ? (
    <span
      className="flex shrink-0 items-center gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      {actions}
    </span>
  ) : null

  const hoverArrow =
    !unavailable && to ? (
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    ) : null

  if (unavailable || !to) {
    return (
      <div
        aria-label={`${type}: ${title}`}
        className={cn(
          'group flex w-full items-center gap-3 rounded-md border bg-background p-3',
          unavailable && 'cursor-default',
          className,
        )}
      >
        {body}
        {hoverArrow}
        {actionNode}
      </div>
    )
  }

  return (
    <Link
      to={to}
      aria-label={`${type}: ${title}`}
      className={cn(
        'group flex w-full items-center gap-3 rounded-md border bg-background p-3 no-underline transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      {body}
      {hoverArrow}
      {actionNode}
    </Link>
  )
}
