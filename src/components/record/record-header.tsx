import { t } from '#/copy'
import * as React from 'react'
import { PresenceStack } from '#/components/collaboration/presence-avatars'

import { cn } from '#/lib/utils'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Icon } from '#/components/icons'

import { RecordHeaderIdentity } from './record-header-identity'
import { RecordHeaderMeta } from './record-header-meta'
import type { RecordHeaderContributor } from './record-header-meta'

/** The contributor shape and the meta strip are `record-header-meta.tsx`'s. */
export type { RecordHeaderContributor } from './record-header-meta'

/**
 * Compact record header — the identity strip above a project, experiment,
 * protocol or dataset. Every field is optional so a record type only shows
 * what it actually provides (UI-004: "fields disappear cleanly").
 *
 * Layout (from the Experiment Notebook / Project Dashboard mockups):
 *   type · status … identifier
 *   Title                         ⭐  …  actions
 *   owner · updated · contributors · tags
 *
 * The three lines are three parts: `RecordHeaderIdentity` for the first, this
 * title row, and `RecordHeaderMeta` for the third.
 */

export interface RecordHeaderProps {
  /** Record kind, e.g. "Project", "Experiment", "Protocol". */
  recordType: string
  title: string
  /** Stable identifier, e.g. "EXP-2025-0014". Omit to hide. */
  identifier?: string
  /** Status badge node (StatusBadge once UI-005 ships it). */
  status?: React.ReactNode
  /** Secondary state pill, e.g. "Phase 2". */
  phase?: React.ReactNode
  /** Owner name and optional initials for the avatar. */
  owner?: { name: string; initials?: string }
  /** Relative or absolute "updated" label. */
  updatedAt?: React.ReactNode
  /** Contributors rendered as a stacked avatar group. */
  contributors?: RecordHeaderContributor[]
  /** Tag badges. */
  tags?: React.ReactNode
  /** Starred state + toggle. */
  starred?: boolean
  onToggleStar?: () => void
  /** Action buttons/links rendered at the right edge. */
  actions?: React.ReactNode
  /** Overflow menu node rendered after actions. */
  menu?: React.ReactNode
  className?: string
}

export function RecordHeader({
  recordType,
  title,
  identifier,
  status,
  phase,
  owner,
  updatedAt,
  contributors,
  tags,
  starred,
  onToggleStar,
  actions,
  menu,
  className,
}: RecordHeaderProps) {
  return (
    <header className={cn('space-y-3', className)}>
      <RecordHeaderIdentity
        recordType={recordType}
        identifier={identifier}
        status={status}
        phase={phase}
      />

      <div className="flex items-start gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {onToggleStar ? (
          <Button
            variant="quiet"
            size="icon"
            aria-label={
              starred
                ? t('notebook.recordHeader.ariaLabel')
                : t('notebook.recordHeader.starRecordAriaLabel')
            }
            aria-pressed={starred}
            onClick={onToggleStar}
          >
            <Icon
              name="star"
              className={cn('size-4', starred && 'fill-current text-primary')}
            />
          </Button>
        ) : null}
        <PresenceStack />
        {actions}
        {menu ?? (
          <Button
            variant="quiet"
            size="icon"
            aria-label={t('notebook.recordHeader.moreActionsAriaLabel')}
            disabled
          >
            <Icon name="more" size={16} />
          </Button>
        )}
      </div>

      <RecordHeaderMeta
        owner={owner}
        updatedAt={updatedAt}
        contributors={contributors}
        tags={tags}
      />
    </header>
  )
}

export { Badge as RecordHeaderBadge }
