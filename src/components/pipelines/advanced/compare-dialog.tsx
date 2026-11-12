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
import { BoardScope } from '#/features/pipelines/board/board'

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
        />
        <DialogBody>
          {rows && rows.added + rows.removed > 0 ? (
            <BoardScope>
              <section
                className="pls-vfw"
                aria-label={t('features.pipelineVersionFile.compare.aria')}
              >
                <div className="pls-atb" style={{ height: 40 }}>
                  <span>
                    {t('features.pipelineVersionFile.compare.summary', {
                      added: rows.added,
                      removed: rows.removed,
                    })}
                  </span>
                </div>
                <pre className="pls-yl pls-diff">
                  {rows.rows.map((row, index) =>
                    row.kind === 'gap' ? (
                      // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- diff rows have no identity of their own; the list is rebuilt whole and never reordered.
                      <span className="l gap" key={`g${index}`}>
                        {t('features.pipelineVersionFile.compare.unchanged', {
                          count: row.hidden,
                        })}
                      </span>
                    ) : (
                      <span
                        className={`l ${row.kind === 'same' ? '' : row.kind}`}
                        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- diff rows have no identity of their own; the list is rebuilt whole and never reordered.
                        key={`${row.before}:${row.after}:${index}`}
                        style={{
                          counterSet: `ln ${(row.after ?? row.before ?? 1) - 1}`,
                        }}
                      >
                        {row.kind === 'add'
                          ? '+ '
                          : row.kind === 'del'
                            ? '- '
                            : '  '}
                        {row.text}
                      </span>
                    ),
                  )}
                </pre>
              </section>
            </BoardScope>
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
