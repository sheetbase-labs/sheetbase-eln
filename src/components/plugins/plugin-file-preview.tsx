import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'

import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { t } from '#/copy'
import { fileExtension, previewWithPlugin } from '#/lib/extensions/plugin-files'
import type { PluginFilePreview } from '#/lib/extensions/plugin-files'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'

/** One row of a plugin's preview table, named by the plugin contract that sends it. */
type PluginPreviewRow = Extract<PluginFilePreview, { kind: 'table' }>['rows'][number]

/**
 * One cell of a plugin's preview table, decoded to the text the table shows.
 *
 * A plugin answers with JSON values, so a missing cell and a JSON `null` both
 * read as the em dash, and every other value is read the way JavaScript reads
 * it (`String`), which is what the table showed before it was decoded.
 */
const previewCellText = z.preprocess(
  (value) => (value === null || value === undefined ? '—' : value),
  z.coerce.string(),
)

/** The text a plugin preview table shows for one cell of one row. */
function previewCellTextOf(row: PluginPreviewRow, column: string): string {
  return previewCellText.parse(row[column])
}

/** The preview a plugin offers for this file name, if any. */
export function usePluginPreview(fileName: string) {
  const points = useExtensionPoints()
  const extension = fileExtension(fileName)

  if (!extension) return undefined

  return points.data.previews.find((item) =>
    item.declaration.extensions.includes(extension),
  )
}

/**
 * A button that shows a file the way a plugin reads it: a table or some text.
 * Nothing is fetched until the button is pressed, so a notebook with several
 * files does not download them all to be looked at.
 */
export function PluginFilePreview({
  fileRecordId,
  fileName,
}: {
  fileRecordId: string
  fileName: string
}) {
  const preview = usePluginPreview(fileName)
  const [open, setOpen] = useState(false)

  const show = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error('No plugin reads this file.')
      const response = await fetch(`/api/files/${fileRecordId}/download`)

      if (!response.ok) throw new Error('The file could not be loaded.')
      const file = new File([await response.blob()], fileName)

      return previewWithPlugin({
        extensionKey: preview.extensionKey,
        previewId: preview.id,
        encoding: preview.declaration.encoding,
        file,
      })
    },
  })

  const data = show.data

  if (!preview) return null

  return (
    // A press inside a notebook block opens it for editing, which would drop
    // this preview, so the press stays here.
    <div
      className="space-y-2"
      data-keep-preview
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Button
        size="sm"
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)

          if (next && !show.data) show.mutate()
        }}
      >
        {open
          ? t('plugins.preview.hide', { name: preview.declaration.title })
          : t('plugins.preview.open', { name: preview.declaration.title })}
      </Button>
      {open && show.isPending ? (
        <p className="text-xs text-fg-muted">{t('plugins.preview.reading')}</p>
      ) : null}
      {open && show.error ? (
        <Banner tone="bad">
          {t('plugins.preview.failed', { reason: show.error.message })}
        </Banner>
      ) : null}
      {open && data?.kind === 'text' ? (
        <pre className="max-h-80 overflow-auto rounded-md border bg-surface-subtle p-3 text-xs">
          {data.text}
        </pre>
      ) : null}
      {open && data?.kind === 'table' ? (
        <div className="max-h-80 overflow-auto rounded-md border">
          <Table>
            <caption className="sr-only">{fileName}</caption>
            <TableHeader>
              <TableRow>
                {data.columns.map((column) => (
                  <TableHead key={column} scope="col">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, index) => (
                <TableRow
                  // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- a plugin's preview rows carry no identity, so the declared row order is the only stable key.
                  key={index}
                >
                  {data.columns.map((column) => (
                    <TableCell key={column}>
                      {previewCellTextOf(row, column)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <p className="text-xs text-fg-muted">
        {t('plugins.preview.from', { plugin: preview.extensionName })}
      </p>
    </div>
  )
}
