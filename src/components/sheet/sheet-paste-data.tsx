import { useState } from 'react'

import { Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import { Field } from '#/components/v3/ui/input'
import { Textarea } from '#/components/v3/inventory/list'
import { parsePastedTable } from '#/lib/sheet-paste'
import type { PastedTable } from '#/lib/sheet-paste'

/**
 * Bring a table into a working sheet: paste it from a spreadsheet, or read a
 * CSV or TSV file. The first row names the new local columns and the values
 * stay local to the sheet, so nothing is governed until a column is promoted.
 */
export function SheetPasteData({
  open,
  onOpenChange,
  busy = false,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  onApply: (table: PastedTable) => void
}) {
  const [text, setText] = useState('')
  const table = parsePastedTable(text)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setText('')
        onOpenChange(next)
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Paste data"
          description="The first row names the columns. Values stay local to this sheet until you promote a column."
        />
        <DialogBody>
          <Field label="Pasted data" hint="Copied cells, CSV or TSV text.">
            <Textarea
              aria-label="Pasted data"
              value={text}
              rows={8}
              disabled={busy}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field label="Or choose a file" hint="CSV or TSV.">
            <input
              type="file"
              aria-label="Data file"
              accept=".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void file.text().then(setText)
              }}
            />
          </Field>
          {text.trim() && !table ? (
            <Notice tone="warn">
              Paste a header row and at least one row of values.
            </Notice>
          ) : null}
          {table ? (
            <p role="status" className="m-0 text-label text-fg-muted">
              {table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'} in{' '}
              {table.headers.length}{' '}
              {table.headers.length === 1 ? 'column' : 'columns'}:{' '}
              {table.headers.join(', ')}
              {table.clipped.columns || table.clipped.rows
                ? `. Left out: ${[
                    table.clipped.columns
                      ? `${table.clipped.columns} more columns`
                      : '',
                    table.clipped.rows ? `${table.clipped.rows} more rows` : '',
                  ]
                    .filter(Boolean)
                    .join(' and ')}.`
                : ''}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={!table || busy}
            onClick={() => table && onApply(table)}
          >
            {busy ? 'Adding…' : 'Add to sheet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
