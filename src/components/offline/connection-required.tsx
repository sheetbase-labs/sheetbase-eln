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
