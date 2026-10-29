import { CircleDashed, MinusCircle, Undo2, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

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
  { icon: IconName | LucideIcon; ring: string; dot: string }
> = {
  pending: {
    icon: CircleDashed,
    ring: 'border-border bg-background text-muted-foreground',
    dot: 'text-muted-foreground',
  },
  active: {
    icon: 'clock',
    ring: 'border-primary bg-primary text-primary-foreground',
    dot: 'text-primary',
  },
  completed: {
    icon: 'check',
    ring: 'border-success bg-success text-success-foreground',
    dot: 'text-success',
  },
  rejected: {
    icon: XCircle,
    ring: 'border-destructive bg-destructive text-destructive-foreground',
    dot: 'text-destructive',
  },
  returned: {
    icon: Undo2,
    ring: 'border-warning bg-warning text-warning-foreground',
    dot: 'text-warning-foreground',
  },
  unavailable: {
    icon: MinusCircle,
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
      ? t('projects.approvalStepper.someone')
      : status.actor.name
    : null
  const by = actor ? t('projects.approvalStepper.by', { actor }) : ''
  const at = status.at
    ? t('projects.approvalStepper.at', { at: status.at })
    : ''
  const title = def.title
  switch (status.state) {
    case 'completed':
      return t('projects.approvalStepper.sentence.completed', { title, by, at })
    case 'active':
      return t('projects.approvalStepper.sentence.active', {
        title,
        since: status.at
          ? t('projects.approvalStepper.since', { at: status.at })
          : '',
      })
    case 'rejected':
      return t('projects.approvalStepper.sentence.rejected', { title, by, at })
    case 'returned':
      return t('projects.approvalStepper.sentence.returned', { title, by, at })
    case 'unavailable':
      return t('projects.approvalStepper.sentence.unavailable', { title })
    case 'pending':
    default:
      return t('projects.approvalStepper.sentence.pending', { title })
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
      aria-label={t('projects.approvalStepper.label')}
    >
      {steps.map((def, i) => {
        const status = reviewState[def.id] ?? {
          state: 'pending',
        }
        const meta = stateMeta[status.state]
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
              {typeof meta.icon === 'string' ? (
                <Icon
                  name={meta.icon}
                  className="size-3.5"
                  aria-hidden="true"
                />
              ) : (
                <meta.icon className="size-3.5" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 pt-1">
              <p className="text-sm font-medium">{def.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t(`projects.approvalStepper.states.${status.state}`)}
                {def.role ? ` · ${def.role}` : ''}
                {status.actor
                  ? ` · ${status.actor.unknown ? t('projects.approvalStepper.unknownUser') : status.actor.name}`
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
