'use client'

/**
 * EXP-05.2 — an action that needs a connection, disabled with its reason
 * stated rather than silently inert (canvas/NbOffline.dc.html: "Submitting
 * needs a connection").
 *
 * The child is a render function so any button/link can receive the two
 * things it must carry while offline: `disabled` and the id its reason is
 * announced at. When online the reason is not rendered and nothing is
 * changed.
 */

import * as React from 'react'

import { cn } from '#/lib/utils'

/** The reasons surfaced for the actions that cannot run offline. */
export const CONNECTION_REQUIRED_REASONS = {
  submit: 'Submitting needs a connection',
  sign: 'Signing needs a connection',
  share: 'Sharing needs a connection',
  import: 'Importing needs a connection',
  rerun: 'Re-running an analysis needs a connection',
  search: 'Search needs a connection',
} as const

export type ConnectionRequiredAction = keyof typeof CONNECTION_REQUIRED_REASONS

export interface ConnectionRequiredState {
  /** True while the connection is unavailable. */
  disabled: boolean
  /** Id of the rendered reason, or undefined when online. */
  describedBy: string | undefined
}

export interface ConnectionRequiredProps {
  /** True while the connection is available. */
  online: boolean
  /** The reason, shown and announced while offline. */
  reason: string
  children: (state: ConnectionRequiredState) => React.ReactNode
  className?: string
}

export function ConnectionRequired({
  online,
  reason,
  children,
  className,
}: ConnectionRequiredProps) {
  const reasonId = React.useId()
  const disabled = !online
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      {children({
        disabled,
        describedBy: disabled ? reasonId : undefined,
      })}
      {disabled ? (
        <span
          id={reasonId}
          data-connection-required-reason
          className="text-label text-fg-muted"
        >
          {reason}
        </span>
      ) : null}
    </span>
  )
}
