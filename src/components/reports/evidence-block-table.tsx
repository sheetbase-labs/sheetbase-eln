import { TableBox } from '#/components/ui/table'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { EvidenceBlock } from '#/lib/reports'
import { t } from '#/copy'

import { blockLabel } from './evidence-block-label'

/**
 * The blocks of one submitted version, one row each, with the row that will be
 * frozen into the report chosen by a radio. The block is shown as the words it
 * held, because that is what the person is choosing between.
 */
export function EvidenceBlockTable({
  blocks,
  loading,
  chosenId,
  onChoose,
}: {
  blocks: readonly EvidenceBlock[]
  loading: boolean
  chosenId: string
  onChoose: (blockId: string) => void
}) {
  const columns: RegistryColumn<EvidenceBlock>[] = [
    {
      id: 'type',
      header: t('projects.reports.evidence.blockType'),
      accessorFn: (b) => blockLabel(b.type),
    },
    {
      id: 'text',
      header: t('projects.reports.evidence.blockText'),
      accessorFn: (b) => b.text,
      cell: ({ row }) => (
        <span className="block max-w-[320px] truncate text-fg-muted">
          {row.original.text || t('projects.reports.evidence.noText')}
        </span>
      ),
    },
  ]

  return (
    <TableBox className="max-h-64 overflow-y-auto">
      <RegistryGrid
        label={t('projects.reports.evidence.blocks')}
        rows={[...blocks]}
        columns={columns}
        getRowId={(b) => b.id}
        rowSelection={chosenId ? { [chosenId]: true } : {}}
        onRowClick={(b) => onChoose(b.id)}
        isLoading={loading}
        empty={t('projects.reports.evidence.noBlocks')}
      />
    </TableBox>
  )
}
