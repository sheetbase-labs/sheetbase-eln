import { useEffect, useMemo, useRef, useState } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { toast } from '#/components/ui/sonner'
import { BoardButton } from '#/features/pipelines/board/board'
import '#/features/pipelines/board/version-file.css'
import { formatTime } from '#/lib/format-date'
import { formatVersionFile, lineOffset } from '#/lib/pipelines/version-file'
import type { FileProblem } from '#/lib/pipelines/version-file'
import { readFileFacts } from '#/lib/pipelines/version-file-facts'
import { hintsAt } from '#/lib/pipelines/version-file-hints'
import type { FileHints } from '#/lib/pipelines/version-file-hints'
import {
  highlightFile,
  markRange,
} from '#/lib/pipelines/version-file-highlight'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { FileDiff } from './file-diff'
import { VersionFileStacked } from './version-file-sidebar'

const LINE_HEIGHT = 19

/** The caret's 1-based line in a textarea. */
function caretLine(area: HTMLTextAreaElement): number {
  return area.value.slice(0, area.selectionStart).split('\n').length
}

/** Type text at the caret so the browser's undo still knows about it. */
function typeText(area: HTMLTextAreaElement, text: string) {
  area.focus()

  if (!document.execCommand('insertText', false, text))
    area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end')
}

/**
 * The version file as the editor: the text on the board's line-numbered
 * frame, a textarea over it for typing, mistakes marked on their lines and
 * listed below with a fix where there is one. The text is the working copy;
 * the version it says is what Try, Save and Publish use.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function, react-doctor/no-giant-component -- the frame, its lines, the toolbar and the problems list share the caret, the text and the check.
export function VersionFileEditor() {
  const editor = usePipelineEditor()

  const { fileText, setFileText, fileCheck, definition, current, draft } =
    editor

  const area = useRef<HTMLTextAreaElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState(1)
  const [view, setView] = useState<'edit' | 'diff'>('edit')
  const [folded, setFolded] = useState(true)

  const [hint, setHint] = useState<
    (FileHints & { line: number; col: number; pick: number }) | null
  >(null)

  const [validatedAt, setValidatedAt] = useState<Date | null>(null)
  const leaveOnTab = useRef(false)
  const problems = fileCheck?.problems ?? []
  const pipeline = definition.data?.display_id ?? definition.data?.key ?? ''

  const lines = useMemo(() => highlightFile(fileText), [fileText])

  const shown =
    lines.length > 1 && fileText.endsWith('\n')
      ? lines.length - 1
      : lines.length

  const facts = useMemo(() => readFileFacts(fileText), [fileText])

  // The header (everything before `steps:`) folds to one line until the caret
  // or a problem is in it.
  const hiddenTo =
    folded &&
    facts.headerLines >= 3 &&
    !problems.some((p) => p.line <= facts.headerLines)
      ? facts.headerLines
      : 0

  const byLine = useMemo(() => {
    const map = new Map<number, FileProblem[]>()

    for (const problem of problems)
      map.set(problem.line, [...(map.get(problem.line) ?? []), problem])

    return map
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- byLine depends only on the problems list.
  }, [problems])

  // Keep the caret in view as the text scrolls inside the frame.
  const reveal = (line: number) => {
    const box = frame.current

    if (!box) return
    const top = (hiddenTo ? line - hiddenTo : line - 1) * LINE_HEIGHT
    const bottom = top + LINE_HEIGHT + 8

    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight - 8)
      box.scrollTop = bottom - box.clientHeight + 16
  }

  const jump = (line: number, column = 1) => {
    const el = area.current

    if (!el) return
    const at = lineOffset(el.value, line) + column - 1

    if (line <= facts.headerLines) setFolded(false)
    el.focus()
    el.setSelectionRange(at, at)
    setCursor(line)
    reveal(line)
  }

  // The outline asks for a line through the editor model.
  useEffect(() => {
    editor.fileJump.current = jump

    return () => {
      editor.fileJump.current = null
    }
  })

  const sync = () => {
    const el = area.current

    if (!el) return
    const line = caretLine(el)

    if (line <= facts.headerLines) setFolded(false)
    setCursor(line)
    reveal(line)
  }

  const accept = (key: string) => {
    const el = area.current

    if (!el || !hint) return
    el.setSelectionRange(
      el.selectionStart - hint.prefix.length,
      el.selectionStart,
    )
    typeText(el, `${key}: `)
    setHint(null)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget

    if (hint) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : hint.keys.length - 1

        setHint({ ...hint, pick: (hint.pick + step) % hint.keys.length })

        return
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault()
        accept(hint.keys[hint.pick])

        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setHint(null)

        return
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault()

      if (editor.dirty && editor.canSave) editor.saveDraft.mutate()

      return
    }

    if (event.key === 'Escape') {
      leaveOnTab.current = true

      return
    }

    if (event.key !== 'Tab') leaveOnTab.current = false

    if (event.key === 'Tab' && !event.shiftKey) {
      if (leaveOnTab.current) return
      event.preventDefault()
      typeText(el, '  ')

      return
    }

    if (event.key === 'Tab' && event.shiftKey) {
      if (leaveOnTab.current) return
      event.preventDefault()
      const start = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1
      const spaces = /^ {1,2}/.exec(el.value.slice(start))?.[0].length ?? 0

      if (!spaces) return
      el.setSelectionRange(start, start + spaces)
      document.execCommand('delete')

      return
    }

    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      const start = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1
      const before = el.value.slice(start, el.selectionStart)
      const indent = /^ */.exec(before)?.[0] ?? ''

      const opens =
        /(:|\|[-+]?)\s*$/.test(before) && !before.trimStart().startsWith('#')

      event.preventDefault()
      typeText(el, `\n${indent}${opens ? '  ' : ''}`)
    }
  }

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
      jump(problems[0].line, problems[0].column)
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
            count: fileCheck?.lineCount ?? shown,
          })}
        </span>
      </div>

      <div className="ye-wrap">
        {view === 'diff' && published ? <FileDiff /> : null}
        <div
          className="ye-ed"
          ref={frame}
          hidden={view === 'diff' && !!published}
          style={{ maxHeight: 'max(240px, calc(100dvh - 360px))' }}
        >
          <div className="ye-stack">
            {hiddenTo ? (
              <button
                type="button"
                className="pls-fold"
                aria-label={t('features.pipelineVersionFile.editor.foldAria', {
                  to: hiddenTo,
                })}
                onClick={() => setFolded(false)}
              >
                {t('features.pipelineVersionFile.editor.fold', {
                  to: hiddenTo,
                  keys: facts.headerKeys.join(', '),
                })}
              </button>
            ) : null}
            {lines.slice(hiddenTo, shown).map((spans, offset) => {
              const index = offset + hiddenTo
              const n = index + 1
              const here = byLine.get(n)

              const parts = here
                ? here.reduce<ReturnType<typeof markRange>>(
                    (acc, p) =>
                      markRange(acc, p.column - 1, p.column - 1 + p.length),
                    spans,
                  )
                : spans

              return (
                <div
                  // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- a line is identified by its number.
                  key={n}
                  className={`ye-l${here ? ' bad' : n === cursor ? ' cur' : ''}`}
                >
                  <span className="ye-n">{n}</span>
                  <span
                    className={`ye-m${here ? ' bad' : ''}`}
                    aria-label={
                      here
                        ? t(
                            'features.pipelineVersionFile.editor.problemOnLine',
                            { line: n },
                          )
                        : undefined
                    }
                  >
                    {here ? <Icon name="warn" size={11} /> : null}
                  </span>
                  <span className="ye-c">
                    {parts.length === 0 ? ' ' : null}
                    {parts.map((span, i) => (
                      <span
                        key={i}
                        className={
                          [
                            span.kind === 'plain' ? '' : span.kind,
                            'bad' in span && span.bad ? 'ye-err' : '',
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
                      >
                        {span.text}
                      </span>
                    ))}
                  </span>
                  <span className="ye-inl">{here ? here[0].message : ''}</span>
                </div>
              )
            })}
            <textarea
              ref={area}
              className="ye-in"
              value={fileText}
              aria-label={t('features.pipelineVersionFile.editor.ariaFile', {
                id: pipeline,
                version: draftLabel,
              })}
              aria-describedby="ye-tab-hint"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              wrap="off"
              onChange={(e) => {
                const el = e.target
                const text = el.value
                const line = text.slice(0, el.selectionStart).split('\n').length
                const col = el.selectionStart - lineOffset(text, line) + 1
                const found = hintsAt(text, line, col)

                setFileText(text)
                setHint(found ? { ...found, line, col, pick: 0 } : null)
              }}
              onBlur={() => setHint(null)}
              onKeyDown={onKeyDown}
              onKeyUp={sync}
              onClick={sync}
              onSelect={sync}
              style={
                hiddenTo
                  ? { top: LINE_HEIGHT - hiddenTo * LINE_HEIGHT }
                  : undefined
              }
            />
            {hint ? (
              <div
                className="ye-hint-anchor"
                style={{
                  position: 'absolute',
                  left: `calc(66px + ${hint.col - 1 - hint.prefix.length}ch)`,
                  top:
                    ((hiddenTo ? hint.line - hiddenTo : hint.line - 1) + 1) *
                    LINE_HEIGHT,
                }}
              >
                <div
                  className="ye-hint"
                  role="listbox"
                  aria-label={t('features.pipelineVersionFile.hints.aria')}
                >
                  {hint.keys.slice(0, 6).map((key, i) => (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={i === hint.pick}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        accept(key)
                      }}
                    >
                      <span className="k">{key}</span>
                      <small>
                        {t(
                          `features.pipelineVersionFile.hints.keys.${key}`,
                          {},
                        )}
                      </small>
                    </button>
                  ))}
                  <div className="f">
                    {t('features.pipelineVersionFile.hints.footer')}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <span id="ye-tab-hint" className="sr-only">
          {t('features.pipelineVersionFile.editor.tabHint')}
        </span>
      </div>

      <VersionFileStacked />
    </>
  )
}
