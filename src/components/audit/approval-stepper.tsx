import {
  Undo2,
  Check,
  CircleDashed,
  Clock,
  MinusCircle,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { cn } from '#/lib/utils'

/**
 * ApprovalStepper — a presentational view of an approval workflow. It takes
 * a workflow definition (steps with id, title, role) and an immutable review
 * state (per-step state + optional actor/at), and renders the current
 * status. It never mutates review state; the commands that do (approve,
 * reject, return, reassign) live elsewhere (UI-007).
 *
 * Step states: pending, active, completed, rejected, returned, unavailable.
 * Connector graphics are decorative; each step exposes a complete sr-only
 * sentence so screen readers do not rely on the connector lines.
 */

export type ApprovalStepState =
  'pending' | 'active' | 'completed' | 'rejected' | 'returned' | 'unavailable'

export interface ApprovalStepDef {
  id: string
  title: string
  /** Role/assignee label, e.g. "Scientific review" or "Emma Liu". */
  role?: string
}

export interface ApprovalStepStatus {
  state: ApprovalStepState
  /** Who acted, when known. */
  actor?: { name: string; unknown?: boolean }
  /** When the action happened. */
  at?: string
}

export interface ApprovalStepperProps {
  steps: ApprovalStepDef[]
  /** Immutable current review state keyed by step id. Missing = pending. */
  reviewState: Record<string, ApprovalStepStatus>
  /** Max height before the stepper scrolls; keeps long workflows usable. */
  maxHeight?: string
  className?: string
}

const stateMeta: Record<
  ApprovalStepState,
  { icon: LucideIcon; label: string; ring: string; dot: string }
> = {
  pending: {
    icon: CircleDashed,
    label: 'Pending',
    ring: 'border-border bg-background text-muted-foreground',
    dot: 'text-muted-foreground',
  },
  active: {
    icon: Clock,
    label: 'In progress',
    ring: 'border-primary bg-primary text-primary-foreground',
    dot: 'text-primary',
  },
  completed: {
    icon: Check,
    label: 'Completed',
    ring: 'border-success bg-success text-success-foreground',
    dot: 'text-success',
  },
  rejected: {
    icon: XCircle,
    label: 'Rejected',
    ring: 'border-destructive bg-destructive text-destructive-foreground',
    dot: 'text-destructive',
  },
  returned: {
    icon: Undo2,
    label: 'Returned',
    ring: 'border-warning bg-warning text-warning-foreground',
    dot: 'text-warning-foreground',
  },
  unavailable: {
    icon: MinusCircle,
    label: 'Unavailable',
    ring: 'border-border bg-muted text-muted-foreground',
    dot: 'text-muted-foreground',
  },
}

function stepSentence(
  def: ApprovalStepDef,
  status: ApprovalStepStatus,
): string {
  const actor = status.actor
    ? status.actor.unknown
      ? 'someone'
      : status.actor.name
    : null
  switch (status.state) {
    case 'completed':
      return `${def.title}: completed${actor ? ` by ${actor}` : ''}${status.at ? ` at ${status.at}` : ''}.`
    case 'active':
      return `${def.title}: in progress${status.at ? ` since ${status.at}` : ''}.`
    case 'rejected':
      return `${def.title}: rejected${actor ? ` by ${actor}` : ''}${status.at ? ` at ${status.at}` : ''}.`
    case 'returned':
      return `${def.title}: returned${actor ? ` by ${actor}` : ''}${status.at ? ` at ${status.at}` : ''}.`
    case 'unavailable':
      return `${def.title}: unavailable.`
    case 'pending':
    default:
      return `${def.title}: pending.`
  }
}

export function ApprovalStepper({
  steps,
  reviewState,
  maxHeight = '20rem',
  className,
}: ApprovalStepperProps) {
  return (
    <ol
      className={cn('space-y-0 overflow-y-auto pr-1', className)}
      style={{ maxHeight }}
      aria-label="Approval workflow"
    >
      {steps.map((def, i) => {
        const status = reviewState[def.id] ?? {
          state: 'pending',
        }
        const meta = stateMeta[status.state]
        const Icon = meta.icon
        const isLast = i === steps.length - 1
        return (
          <li
            key={def.id}
            className={cn('relative flex gap-3', isLast ? 'pb-0' : 'pb-5')}
          >
            {!isLast ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px',
                  meta.dot.replace('text-', 'bg-').replace('500', '500/40'),
                )}
              />
            ) : null}
            <span
              className={cn(
                'relative z-10 flex size-7 items-center justify-center rounded-full border',
                meta.ring,
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-1">
              <p className="text-sm font-medium">{def.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {meta.label}
                {def.role ? ` · ${def.role}` : ''}
                {status.actor
                  ? ` · ${status.actor.unknown ? 'Unknown user' : status.actor.name}`
                  : ''}
                {status.at ? ` · ${status.at}` : ''}
              </p>
            </div>
            <span className="sr-only">{stepSentence(def, status)}</span>
          </li>
        )
      })}
    </ol>
  )
}
