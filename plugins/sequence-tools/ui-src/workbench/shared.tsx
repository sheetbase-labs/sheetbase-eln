/**
 * Pieces every tab of the sequence workbench uses: the draft it edits, one
 * small table, and the sequence in the shape the map components read.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'

import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { listFiles, readTextFile } from '#/lib/host'
import type { BlockContext } from '#/lib/host'
import { isSequenceFileName } from '#/lib/sequence'
import { useAsync } from '#/lib/use-async'
import { Select } from '#/components/ui/select'
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'
import type { ParsedSequence } from '#/lib/sequence'
import type { SequenceBlockPayload } from '#/lib/sequence-block'
import { cn } from '#/lib/utils'

/** What a tab gets: the sequence block being edited and how to change it. */
export interface WorkbenchProps {
  draft: SequenceBlockPayload
  /** Change the block; the page saves it. */
  edit: (
    change: (current: SequenceBlockPayload) => SequenceBlockPayload,
  ) => void
  canEdit: boolean
  /** The notebook this block is in. */
  recordId: string
  blockId: string
  /** Where this block is, and which plugin block it is. */
  context: BlockContext
  /** Put a new sequence block below this one. */
  insertBelow?: (payload: Record<string, unknown>) => void
}

export function parsedOf(p: SequenceBlockPayload): ParsedSequence {
  return {
    name: p.name || p.title || '',
    description: p.caption ?? '',
    organism: null,
    molecule: p.molecule,
    topology: p.topology,
    length: p.residues.length,
    residues: p.residues,
    features: p.features,
  }
}

export interface Column<T> {
  key: string
  head: ReactNode
  cell: (row: T, index: number) => ReactNode
  align?: 'right'
  className?: string
}

/** The workbench's table: the app's own Table, with a message when empty. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  empty,
  rowKey,
  selectedKey,
}: {
  caption: string
  columns: readonly Column<T>[]
  rows: readonly T[]
  empty: ReactNode
  rowKey: (row: T, index: number) => string
  selectedKey?: string | null
}) {
  return (
    <TableBox>
      <Table caption={caption}>
        <TableHeader>
          <tr>
            {columns.map((c) => (
              <TableHead key={c.key} align={c.align}>
                {c.head}
              </TableHead>
            ))}
          </tr>
        </TableHeader>
        <TableBody empty={empty} colSpan={columns.length}>
          {rows.map((row, i) => {
            const key = rowKey(row, i)
            return (
              <TableRow key={key} selected={key === selectedKey}>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    align={c.align}
                    className={cn('num', c.className)}
                  >
                    {c.cell(row, i)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableBox>
  )
}

/** A short block of explanation under a heading, used by every tab. */
export function Panel({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  hint?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-2', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center gap-2">
          {title ? (
            <h3 className="text-body font-medium text-fg">{title}</h3>
          ) : null}
          {actions ? <div className="ml-auto flex gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {hint ? <p className="text-label text-fg-muted">{hint}</p> : null}
      {children}
    </section>
  )
}

export function oneBased(start0: number): number {
  return start0 + 1
}

/** Format a number with a fixed number of decimals, no trailing zeros. */
export function fixed(n: number, digits = 1): string {
  return Number(n.toFixed(digits)).toString()
}

/** Sequence files linked to this notebook (GenBank or FASTA), to pick one. */
export function RecordFilePicker({
  onPick,
  disabled,
}: {
  onPick: (text: string, name: string) => void
  disabled?: boolean
}) {
  const files = useAsync(listFiles, 'files')
  const sequences = useMemo(
    () => (files.data ?? []).filter((f) => isSequenceFileName(f.name)),
    [files.data],
  )
  if (sequences.length === 0) return null
  return (
    <Select
      aria-label={t('molbio.edit.recordFiles')}
      className="w-64"
      disabled={disabled}
      value=""
      onChange={(e) => {
        const file = sequences.find((f) => f.fileRecordId === e.target.value)
        if (!file) return
        readTextFile(file.fileRecordId).then(
          (text) => onPick(text, file.name),
          (error: unknown) =>
            toast.error(error instanceof Error ? error.message : String(error)),
        )
      }}
    >
      <option value="">{t('molbio.edit.recordFiles')}</option>
      {sequences.map((f) => (
        <option key={f.fileRecordId} value={f.fileRecordId}>
          {f.name}
        </option>
      ))}
    </Select>
  )
}
