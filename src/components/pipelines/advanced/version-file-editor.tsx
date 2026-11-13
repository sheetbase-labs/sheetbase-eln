import { useEffect, useMemo, useRef, useState } from 'react'

import { t } from '#/copy'
import { CodeEditor } from '#/components/code-editor/code-editor'
import type { CodeEditorHandle } from '#/components/code-editor/code-editor'
import { toast } from '#/components/ui/sonner'
import { BoardButton } from '#/features/pipelines/board/board'
import '#/features/pipelines/board/version-file.css'
import { formatTime } from '#/lib/format-date'
import { applyFix, formatVersionFile } from '#/lib/pipelines/version-file'
import { readFileFacts } from '#/lib/pipelines/version-file-facts'
import { hintsAt } from '#/lib/pipelines/version-file-hints'
import { fileTokens } from '#/lib/pipelines/version-file-highlight'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { FileDiff } from './file-diff'
import { VersionFileStacked } from './version-file-sidebar'

/** The one-line note for a suggested key. */
function hintNote(key: string) {
  // SAFETY: every key `hintsAt` offers has a plain note under hints.keys in the copy; the one literal stands for them all.
  return t(
    `features.pipelineVersionFile.hints.keys.${key}` as 'features.pipelineVersionFile.hints.keys.pipeline',
  )
}

/**
 * The version file as the editor: the text on the board's line-numbered
 * frame, mistakes marked on their lines with the message and fix under them.
 * The text is the working copy; the version it says is what Try, Save and
 * Publish use.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the toolbar, the editor and the file's problems share the working text.
export function VersionFileEditor() {
  const editor = usePipelineEditor()

  const { fileText, setFileText, fileCheck, definition, current, draft } =
    editor

  const area = useRef<CodeEditorHandle>(null)
  const [view, setView] = useState<'edit' | 'diff'>('edit')
  const [validatedAt, setValidatedAt] = useState<Date | null>(null)
  const pipeline = definition.data?.display_id ?? definition.data?.key ?? ''
  const facts = useMemo(() => readFileFacts(fileText), [fileText])

  const problems = useMemo(
    () =>
      (fileCheck?.problems ?? []).map((problem) => ({
        line: problem.line,
        column: problem.column,
        length: problem.length,
        title: t('features.pipelineVersionFile.editor.lineN', {
          line: problem.line,
        }),
        message: problem.message,
        fix: problem.fix
          ? {
              label: problem.fix.label,
              run: () => {
                if (problem.fix) setFileText(applyFix(fileText, problem.fix))
              },
            }
          : undefined,
      })),
    [fileCheck, fileText, setFileText],
  )

  // The header (everything before `steps:`) folds to one row until the caret
  // or a mistake is in it.
  const fold =
    facts.headerLines >= 3 && !problems.some((p) => p.line <= facts.headerLines)
      ? {
          lines: facts.headerLines,
          label: t('features.pipelineVersionFile.editor.fold', {
            to: facts.headerLines,
            keys: facts.headerKeys.join(', '),
          }),
          ariaLabel: t('features.pipelineVersionFile.editor.foldAria', {
            to: facts.headerLines,
          }),
        }
      : undefined

  // The outline asks for a line through the editor model.
  useEffect(() => {
    editor.fileJump.current = (line, column) => area.current?.jump(line, column)

    return () => {
      editor.fileJump.current = null
    }
  })

  const validate = () => {
    setValidatedAt(new Date())

    if (!problems.length)
      toast(t('features.pipelineVersionFile.editor.noProblemsToast'))
    else {
      toast.error(
        t('features.pipelineVersionFile.editor.problemsToast', {
          count: problems.length,
        }),
      )
      area.current?.jump(problems[0].line, problems[0].column)
    }
  }

  const format = () => {
    const tidy = formatVersionFile(fileText)

    if (tidy === fileText) return
    setFileText(tidy)
  }

  const savedAt = (draft ?? current)?.updated_at
  const fileName = `${definition.data?.key ?? 'pipeline'}.yaml`

  const draftLabel = draft
    ? `draft v${draft.version}`
    : current
      ? `v${current.version}`
      : ''

  const published = current?.lifecycle === 'published' ? current : undefined

  return (
    <>
      <div className="ye-bar">
        <span
          className="pls-seg"
          role="group"
          aria-label={t('features.pipelineVersionFile.editor.view')}
        >
          <button
            type="button"
            aria-pressed={view === 'edit'}
            onClick={() => setView('edit')}
          >
            {t('features.pipelineVersionFile.editor.edit')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'diff'}
            disabled={!published}
            onClick={() => setView('diff')}
          >
            {published
              ? t('features.pipelineVersionFile.editor.diffWith', {
                  version: published.version,
                })
              : t('features.pipelineVersionFile.editor.diff')}
          </button>
        </span>
        <BoardButton size="sm" icon="check" onClick={validate}>
          {t('features.pipelineVersionFile.editor.validate')}
        </BoardButton>
        <BoardButton variant="quiet" size="sm" onClick={format}>
          {t('features.pipelineVersionFile.editor.format')}
        </BoardButton>
        <span className="muted">
          {savedAt
            ? t('features.pipelineVersionFile.editor.savedAt', {
                when: formatTime(savedAt),
              })
            : t('features.pipelineVersionFile.editor.notSaved')}
          {validatedAt
            ? ` · ${t('features.pipelineVersionFile.editor.validatedAt', {
                when: formatTime(validatedAt),
              })}`
            : ''}
        </span>
        <span style={{ flexGrow: 1 }} />
        <BoardButton
          size="sm"
          disabled={
            !editor.dirty || !editor.canSave || editor.saveDraft.isPending
          }
          onClick={() => editor.saveDraft.mutate()}
        >
          {t('data.stepList.saveDraft')}
        </BoardButton>
        <span className="muted mono" style={{ fontSize: 11 }}>
          {t('features.pipelineVersionFile.editor.fileLines', {
            name: fileName,
            count: fileCheck?.lineCount ?? fileText.split('\n').length,
          })}
        </span>
      </div>

      <div className="ye-wrap">
        {view === 'diff' && published ? <FileDiff /> : null}
        <div hidden={view === 'diff' && !!published}>
          <CodeEditor
            ref={area}
            value={fileText}
            onChange={setFileText}
            ariaLabel={t('features.pipelineVersionFile.editor.ariaFile', {
              id: pipeline,
              version: draftLabel,
            })}
            className="ye-ed"
            highlight={fileTokens}
            problems={problems}
            fold={fold}
            indentAfter={/(:|\|[-+]?)\s*$/}
            onSave={() => {
              if (editor.dirty && editor.canSave) editor.saveDraft.mutate()
            }}
            suggest={(text, line, column) => {
              const found = hintsAt(text, line, column)

              return found
                ? {
                    prefixLength: found.prefix.length,
                    options: found.keys.slice(0, 6).map((key) => ({
                      label: key,
                      insert: `${key}: `,
                      note: hintNote(key),
                    })),
                  }
                : null
            }}
            suggestFooter={t('features.pipelineVersionFile.hints.footer')}
            maxHeight="max(240px, calc(100dvh - 360px))"
          />
        </div>
        <span id="ye-tab-hint" className="sr-only">
          {t('features.pipelineVersionFile.editor.tabHint')}
        </span>
      </div>

      <VersionFileStacked />
    </>
  )
}
