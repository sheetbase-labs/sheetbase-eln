import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'
import { objectPath } from '#/lib/navigation'
import { useWorkspaceNavigation } from '#/components/workspace/workspace-navigation'

/**
 * An identifier shown as a link to the page that owns the object.
 *
 * Every place that names an experiment, dataset, sample, analysis or project by
 * its identifier uses this instead of a bare `<span className="mono">`, so
 * "EXP-0142" is always a way to open EXP-0142. `id` is the row UUID when the
 * caller has it; otherwise the display identifier is enough, because every
 * owning route resolves both. A kind with no page of its own, or a reference
 * with nothing to link to, renders as plain text rather than a dead link.
 */
export function ObjectLink({
  kind,
  id,
  identifier,
  children,
  mono = true,
  className,
}: {
  kind: string
  /** The row UUID, when known. */
  id?: string | null
  /** The display identifier, e.g. `DS-0311`. Shown unless `children` is given. */
  identifier?: string | null
  children?: ReactNode
  /** Identifiers use the monospace face; a title does not. */
  mono?: boolean
  className?: string
}) {
  const ref = id || identifier || ''
  const workspace = useWorkspaceNavigation()
  const to = ref ? objectPath(kind, ref) : null
  const label = children ?? identifier ?? id ?? ''
  if (!to) {
    return <span className={cn(mono && 'mono', className)}>{label}</span>
  }
  return (
    <Link
      to={to}
      className={cn('text-link', mono && 'mono', className)}
      // A row that is itself clickable must not also navigate twice.
      onClick={(event) => {
        event.stopPropagation()
        if (
          workspace &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          event.button === 0
        ) {
          event.preventDefault()
          workspace.open(to, {
            beside: true,
            title: typeof label === 'string' ? label : undefined,
          })
        }
      }}
    >
      {label}
    </Link>
  )
}
