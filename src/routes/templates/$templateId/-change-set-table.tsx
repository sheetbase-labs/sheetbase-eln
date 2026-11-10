import { Muted } from '#/components/ui/layout'
import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { TemplateChangeSetEntry } from '#/lib/notebook-template-change-set'
import { t } from '#/copy'

import { changeSetColumns } from './-versions-columns'

/** One version's recorded definition changes, or the note that there were none. */
export function ChangeSetTable({
  entries,
  label,
}: {
  entries: TemplateChangeSetEntry[]
  label: string
}) {
  if (!entries.length) {
    return (
      <Muted>
        {t('library.templates.versions.noDefinitionChangesRecordedBetween')}
      </Muted>
    )
  }

  return (
    <TableBox>
      <RegistryGrid
        label={label}
        rows={entries}
        columns={changeSetColumns}
        getRowId={(entry) =>
          `${entry.tag}-${entry.kind}-${entry.id}-${entry.field ?? ''}`
        }
        selectable={false}
      />
    </TableBox>
  )
}
