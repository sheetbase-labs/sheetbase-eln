import { useMemo } from 'react'

import { t } from '#/copy'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '#/components/ui/dialog'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { readStoredConfig } from '#/lib/pipelines/step-list'
import { versionFileText } from '#/lib/pipelines/version-file'
import {
  countChanges,
  diffLines,
  withContext,
} from '#/lib/pipelines/version-file-diff'
import '#/features/pipelines/board/version-file.css'

/** The version number is the file's own line; leaving it out keeps it from showing as a change. */
const withoutVersion = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('version:'))
    .join('\n')

/** The published version's file against the one in the editor, line by line. */
export function CompareDialog({ onClose }: { onClose: () => void }) {
  const editor = usePipelineEditor()
  const { definition, fileText } = editor

  const current =
    editor.current?.lifecycle === 'published' ? editor.current : undefined

  const rows = useMemo(() => {
    const stored = current ? readStoredConfig(current.configuration) : null

    if (!stored || !current) return null

    const published = versionFileText(stored, {
      title: definition.data?.name,
      pipeline: definition.data?.display_id ?? definition.data?.key ?? '',
    })

    const lines = diffLines(withoutVersion(published), withoutVersion(fileText))

    return { lines, rows: withContext(lines, 3), ...countChanges(lines) }
  }, [current, definition.data, fileText])

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader
          title={t('features.pipelineVersionFile.compare.title', {
            version: current?.version ?? 0,
          })}
          description={
            rows
              ? t('features.pipelineVersionFile.compare.summary', {
                  added: rows.added,
                  removed: rows.removed,
                })
              : undefined
          }
        />
        <DialogBody>
          {rows && rows.added + rows.removed > 0 ? (
            <div
              className="ye-diff pb-scope"
              // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- a diff is a div grid of lines, not tabular data a table element would fit.
              role="table"
              aria-label={t('features.pipelineVersionFile.compare.aria')}
            >
              {rows.rows.map((row, index) =>
                row.kind === 'gap' ? (
                  // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- diff rows have no identity of their own; the list is rebuilt whole and never reordered.
                  <div className="d gap" role="row" key={`g${index}`}>
                    {t('features.pipelineVersionFile.compare.unchanged', {
                      count: row.hidden,
                    })}
                  </div>
                ) : (
                  <div
                    className={`d ${row.kind === 'same' ? '' : row.kind}`}
                    role="row"
                    key={`${row.before}:${row.after}:${index}`}
                  >
                    <span aria-hidden="true">
                      {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
                    </span>
                    <span>{row.text || ' '}</span>
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="m-0 text-body text-fg-muted">
              {t('features.pipelineVersionFile.compare.same', {
                version: current?.version ?? 0,
              })}
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
