import { t } from '#/copy'
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
          title={t('notebook.sheetPasteData.title')}
          description={t('notebook.sheetPasteData.description')}
        />
        <DialogBody>
          <Field
            label={t('notebook.sheetPasteData.label')}
            hint={t('notebook.sheetPasteData.hint')}
          >
            <Textarea
              aria-label={t('notebook.sheetPasteData.label')}
              value={text}
              rows={8}
              disabled={busy}
              spellCheck={false}
              className="font-mono text-xs"
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field
            label={t('notebook.sheetPasteData.orChooseAFileLabel')}
            hint={t('notebook.sheetPasteData.csvOrTsvHint')}
          >
            <input
              type="file"
              aria-label={t('notebook.sheetPasteData.ariaLabel')}
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
              {t('notebook.sheetPasteData.pasteAHeaderRow')}
            </Notice>
          ) : null}
          {table ? (
            <p role="status" className="m-0 text-label text-fg-muted">
              {t('notebook.sheetPasteData.summary', {
                rows: t('common.counts.rows', { count: table.rows.length }),
                columns: t('notebook.sheetPasteData.columns', {
                  count: table.headers.length,
                }),
                headers: table.headers.join(', '),
              })}
              {table.clipped.columns || table.clipped.rows
                ? t('notebook.sheetPasteData.leftOutValue', {
                    value: [
                      table.clipped.columns
                        ? t('notebook.sheetPasteData.moreColumns', {
                            count: table.clipped.columns,
                          })
                        : '',
                      table.clipped.rows
                        ? t('notebook.sheetPasteData.moreRows', {
                            count: table.clipped.rows,
                          })
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' and '),
                  })
                : ''}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={!table || busy}
            onClick={() => table && onApply(table)}
          >
            {busy
              ? t('notebook.sheetPasteData.adding')
              : t('notebook.sheetPasteData.addToSheet')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
