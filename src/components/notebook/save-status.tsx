/**
 * ELN-007 — per-block autosave status indicator. Renders a truthful,
 * compact summary of the block's autosave state next to (or below) the
 * editor. Communicates by icon shape AND colour (DESIGN.md: never colour
 * alone) and stays unobtrusive when the block is clean.
 *
 * The indicator is presentational; `useAutosave` owns the state.
 */
import * as React from 'react'
import { Icon } from '#/components/v3/icons'
import { Spinner } from '#/components/v3/ui/spinner'

import { cn } from '#/lib/utils'
import type { AutosaveStatus } from './use-autosave'

const META: Record<
  AutosaveStatus,
  {
    label: string
    icon: React.ReactNode
    className: string
    /** `data-save-status` test hook + a11y attribute source. */
    testId: string
  }
> = {
  clean: {
    label: 'Saved',
    icon: <Icon name="check" size={12} aria-hidden="true" />,
    className: 'text-success-text',
    testId: 'clean',
  },
  dirty: {
    label: 'Editing…',
    icon: <Icon name="edit" size={12} aria-hidden="true" />,
    className: 'text-fg-muted',
    testId: 'dirty',
  },
  saving: {
    label: 'Saving…',
    icon: <Spinner size={12} />,
    className: 'text-fg-muted',
    testId: 'saving',
  },
  retrying: {
    label: 'Retrying…',
    icon: <Spinner size={12} />,
    className: 'text-warning-text',
    testId: 'retrying',
  },
  offline: {
    label: 'Offline — will save when reconnected',
    icon: <Icon name="warn" size={12} aria-hidden="true" />,
    className: 'text-warning-text',
    testId: 'offline',
  },
  failed: {
    label: 'Save failed',
    icon: <Icon name="warn" size={12} aria-hidden="true" />,
    className: 'text-danger-text',
    testId: 'failed',
  },
  conflict: {
    label: 'Conflict — needs review',
    icon: <Icon name="warn" size={12} aria-hidden="true" />,
    className: 'text-danger-text',
    testId: 'conflict',
  },
}

export interface SaveStatusProps {
  status: AutosaveStatus
  /** Optional message override (e.g. the validation error). */
  message?: string | null
  className?: string
}

export function SaveStatus({ status, message, className }: SaveStatusProps) {
  const meta = META[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        meta.className,
        className,
      )}
      data-save-status={meta.testId}
      role="status"
      aria-live="polite"
    >
      {meta.icon}
      <span>{message ?? meta.label}</span>
    </span>
  )
}
