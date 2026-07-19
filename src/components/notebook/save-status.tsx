/**
 * ELN-007 — per-block autosave status indicator. Renders a truthful,
 * compact summary of the block's autosave state next to (or below) the
 * editor. Communicates by icon shape AND colour (DESIGN.md: never colour
 * alone) and stays unobtrusive when the block is clean.
 *
 * The indicator is presentational; `useAutosave` owns the state.
 */
import * as React from 'react'
import {
  Check,
  Loader2,
  PencilLine,
  RefreshCw,
  TriangleAlert,
  WifiOff,
} from 'lucide-react'

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
    icon: <Check className="size-3" aria-hidden="true" />,
    className: 'text-emerald-600 dark:text-emerald-400',
    testId: 'clean',
  },
  dirty: {
    label: 'Editing…',
    icon: <PencilLine className="size-3" aria-hidden="true" />,
    className: 'text-muted-foreground',
    testId: 'dirty',
  },
  saving: {
    label: 'Saving…',
    icon: <Loader2 className="size-3 animate-spin" aria-hidden="true" />,
    className: 'text-muted-foreground',
    testId: 'saving',
  },
  retrying: {
    label: 'Retrying…',
    icon: <RefreshCw className="size-3 animate-spin" aria-hidden="true" />,
    className: 'text-amber-600 dark:text-amber-400',
    testId: 'retrying',
  },
  offline: {
    label: 'Offline — will save when reconnected',
    icon: <WifiOff className="size-3" aria-hidden="true" />,
    className: 'text-amber-600 dark:text-amber-400',
    testId: 'offline',
  },
  failed: {
    label: 'Save failed',
    icon: <TriangleAlert className="size-3" aria-hidden="true" />,
    className: 'text-destructive',
    testId: 'failed',
  },
  conflict: {
    label: 'Conflict — needs review',
    icon: <TriangleAlert className="size-3" aria-hidden="true" />,
    className: 'text-destructive',
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
