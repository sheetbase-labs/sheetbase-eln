import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'

import { CodeEditor } from '#/components/code-editor/code-editor'
import { Banner } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { PreviewGrid } from '#/components/inventory/preview-grid'
import { t } from '#/copy'
import { fileExtension, previewWithPlugin } from '#/lib/extensions/plugin-files'
import type { PluginFilePreview } from '#/lib/extensions/plugin-files'
import { useExtensionPoints } from '#/lib/extensions/use-extension-points'

/** One row of a plugin's preview table, named by the plugin contract that sends it. */
type PluginPreviewRow = Extract<
  PluginFilePreview,
  { kind: 'table' }
>['rows'][number]

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
        <CodeEditor
          readOnly
          wrap
          lineNumbers={false}
          ariaLabel={t('plugins.preview.textAria', { name: fileName })}
          value={data.text}
          minHeight="72px"
          maxHeight="320px"
        />
      ) : null}
      {open && data?.kind === 'table' ? (
        <div className="overflow-hidden rounded-md border">
          <PreviewGrid
            label={fileName}
            columns={data.columns}
            rows={data.rows.map((row) =>
              Object.fromEntries(
                data.columns.map((column) => [
                  column,
                  previewCellTextOf(row, column),
                ]),
              ),
            )}
            maxHeight={320}
          />
        </div>
      ) : null}
      <p className="text-xs text-fg-muted">
        {t('plugins.preview.from', { plugin: preview.extensionName })}
      </p>
    </div>
  )
}
