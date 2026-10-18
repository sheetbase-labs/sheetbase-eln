import * as React from 'react'
// ArrowUpRight/FileWarning/Trash2 have no v3 equivalents.
import { ArrowUpRight, FileWarning, Trash2 } from 'lucide-react'

import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { Row } from '#/components/v3/ui/row'
import type { RowDensity } from '#/components/v3/ui/row'
import { cn } from '#/lib/utils'

/**
 * RecordLink — a relationship to another record (used in inspectors, lists
 * and "linked records" sections). It is a real link when the target exists
 * and the viewer can reach it, and an honest, non-interactive row when it
 * does not.
 *
 * States (UI-005, extended by KNOW-01 with `archived`): available, archived,
 * missing (target not found), deleted (soft-deleted), permission-restricted
 * (viewer lacks access). Each non-available state explains itself in text
 * and never renders a link. Auxiliary actions (open, unlink, etc.) are
 * preserved and stay keyboard-operable.
 *
 * This is the single implementation of the entity row (JH-1): the chrome is
 * the v3 `Row`, and the five states are this component's own mapping onto it.
 * `LinkedRecordList`, the competing twin that could not express an unavailable
 * state, is gone; a list of records is `RowList` of `RecordLink`s.
 */

export type RecordLinkState =
  'available' | 'archived' | 'missing' | 'deleted' | 'permission-restricted'

export interface RecordLinkProps {
  /** Internal path. Required for `available`; ignored for other states. */
  to?: string
  /** Record kind, e.g. "Sample", "Protocol". */
  type: string
  title: string
  meta?: string
  icon?: IconName
  state?: RecordLinkState
  /** Auxiliary actions rendered at the right edge (buttons/links). */
  actions?: React.ReactNode
  /**
   * Row scale. `card` is the record row that stands on its own; `list` is the
   * compact row inside an inspector list (and is what a `RowList` imposes).
   */
  density?: RowDensity
  /** Hover detail for the row — e.g. when and by whom the link was made. */
  detail?: string
  className?: string
}

const stateMeta: Record<
  Exclude<RecordLinkState, 'available'>,
  {
    icon: (compact: boolean) => React.ReactNode
    label: string
    className: string
  }
> = {
  archived: {
    icon: (compact) => (
      <Icon name="archive" className={compact ? 'size-3' : 'size-4'} />
    ),
    label: 'Archived',
    className: 'text-fg-muted',
  },
  missing: {
    icon: (compact) => (
      <FileWarning className={compact ? 'size-3' : 'size-4'} />
    ),
    label: 'Unavailable',
    className: 'text-fg-muted',
  },
  deleted: {
    icon: (compact) => <Trash2 className={compact ? 'size-3' : 'size-4'} />,
    label: 'Deleted',
    className: 'text-fg-muted line-through',
  },
  'permission-restricted': {
    icon: (compact) => (
      <Icon name="lock" className={compact ? 'size-3' : 'size-4'} />
    ),
    label: 'Permission restricted',
    className: 'text-fg-muted',
  },
}

export function RecordLink({
  to,
  type,
  title,
  meta,
  icon = 'link',
  state = 'available',
  actions,
  density = 'card',
  detail,
  className,
}: RecordLinkProps) {
  const unavailable = state !== 'available'
  const stateInfo = unavailable ? stateMeta[state] : null
  const compact = density === 'list'

  return (
    <Row
      to={unavailable ? undefined : to}
      density={density}
      detail={detail}
      className={cn('group', className)}
      aria-label={`${type}: ${title}`}
      leading={
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md',
            compact ? 'size-6' : 'size-8',
            unavailable
              ? 'bg-surface-muted text-fg-muted'
              : 'bg-primary/10 text-primary-text',
          )}
        >
          {stateInfo ? (
            stateInfo.icon(compact)
          ) : (
            <Icon name={icon} className={compact ? 'size-3' : 'size-4'} />
          )}
        </span>
      }
      eyebrow={type}
      title={<span className={stateInfo?.className}>{title}</span>}
      meta={stateInfo ? stateInfo.label : meta}
      trailing={
        <>
          {actions ? (
            <span
              className="flex shrink-0 items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              {actions}
            </span>
          ) : null}
          {!unavailable && to ? (
            <ArrowUpRight
              className={cn(
                'shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100',
                compact ? 'size-3.5' : 'size-4',
              )}
            />
          ) : null}
        </>
      }
    />
  )
}
