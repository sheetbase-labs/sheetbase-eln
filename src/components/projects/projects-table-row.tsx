import { Link } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Status } from '#/components/ui/status'
import { TableCell, TableRow } from '#/components/ui/table'
import { t } from '#/copy'
import { cn } from '#/lib/utils'

import { stickyCol } from './mobile-list'
import type { ProjectColumnKey } from './projects-page-model'
import type { ProjectRow } from './types'

/**
 * One project in the table. The row opens the project, the name is a link that
 * does the same, and the chevron says so to a keyboard or screen reader. The
 * select checkbox stops its own click so ticking it does not open the record.
 */
export function ProjectsTableRow({
  project,
  columns,
  canBulkArchive,
  checked,
  onToggle,
  onOpen,
}: {
  project: ProjectRow
  columns: readonly { key: ProjectColumnKey; label: string }[]
  canBulkArchive: boolean
  checked: boolean
  onToggle: (id: string, on: boolean) => void
  onOpen: (project: ProjectRow, event?: React.MouseEvent) => void
}) {
  const p = project

  return (
    <TableRow
      selected={checked}
      className="cursor-pointer"
      onClick={() => onOpen(p)}
    >
      {canBulkArchive ? (
        <TableCell
          className="max-xl:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            aria-label={t('projects.projectsPage.select', { id: p.id })}
            checked={checked}
            onCheckedChange={(on) => onToggle(p.id, on)}
          />
        </TableCell>
      ) : null}
      <TableCell className="mono text-fg-muted max-xl:hidden">{p.id}</TableCell>
      <TableCell
        className={cn(
          stickyCol,
          'max-xl:h-auto max-xl:py-1',
          checked && 'font-medium',
        )}
      >
        <Link
          to="/projects/$projectId"
          params={{ projectId: p.uuid }}
          onClick={(event) => onOpen(p, event)}
          className="cursor-pointer text-inherit underline-offset-2 hover:underline"
        >
          {p.name}
        </Link>
        <span className="mono block text-[11px] text-fg-muted xl:hidden">
          {p.id}
        </span>
      </TableCell>
      {columns.map((c) => (
        <TableCell
          key={c.key}
          className={c.key === 'modality' ? 'lg:hidden' : undefined}
          align={c.key === 'experiments' ? 'right' : undefined}
        >
          {c.key === 'experiments' ? p.experiments : String(p[c.key])}
        </TableCell>
      ))}
      <TableCell>
        <span className="flex items-center justify-end gap-2">
          <Status tone={p.status.tone}>{p.status.label}</Status>
          <Button
            variant="quiet"
            icon="chevronRight"
            aria-label={t('projects.projectsPage.open', { name: p.name })}
            onClick={(event) => {
              event.stopPropagation()
              onOpen(p)
            }}
          />
        </span>
      </TableCell>
    </TableRow>
  )
}
