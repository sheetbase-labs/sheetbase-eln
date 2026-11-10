import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
  return (
    <TableBox className="max-h-64 overflow-y-auto">
      <Table caption={t('projects.reports.evidence.blocks')}>
        <TableHeader>
          <tr>
            <TableHead className="w-8" />
            <TableHead>{t('projects.reports.evidence.blockType')}</TableHead>
            <TableHead>{t('projects.reports.evidence.blockText')}</TableHead>
          </tr>
        </TableHeader>
        <TableBody
          loading={loading}
          empty={
            blocks.length === 0
              ? t('projects.reports.evidence.noBlocks')
              : undefined
          }
          colSpan={3}
        >
          {blocks.map((b) => (
            <TableRow key={b.id} selected={b.id === chosenId}>
              <TableCell className="first:pl-6">
                <input
                  type="radio"
                  name="evidence-block"
                  aria-label={blockLabel(b.type)}
                  checked={b.id === chosenId}
                  onChange={() => onChoose(b.id)}
                />
              </TableCell>
              <TableCell>{blockLabel(b.type)}</TableCell>
              <TableCell className="max-w-[320px] truncate text-fg-muted">
                {b.text || t('projects.reports.evidence.noText')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableBox>
  )
}
