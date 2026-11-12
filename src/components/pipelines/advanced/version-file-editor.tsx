import { useEffect, useMemo, useRef, useState } from 'react'

import { t } from '#/copy'
import { Icon } from '#/components/icons'
import { toast } from '#/components/ui/sonner'
import { BoardButton } from '#/features/pipelines/board/board'
import '#/features/pipelines/board/version-file.css'
import { formatTime } from '#/lib/format-date'
import {
  applyFix,
  formatVersionFile,
  lineOffset,
} from '#/lib/pipelines/version-file'
import type { FileProblem } from '#/lib/pipelines/version-file'
import {
  highlightFile,
  markRange,
} from '#/lib/pipelines/version-file-highlight'
import { usePipelineEditor } from '#/components/pipelines/step-list/use-pipeline-editor'
import { CompareDialog } from './compare-dialog'

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
  const [comparing, setComparing] = useState(false)
  const [validatedAt, setValidatedAt] = useState<Date | null>(null)
  const leaveOnTab = useRef(false)
  const problems = fileCheck?.problems ?? []
  const pipeline = definition.data?.display_id ?? definition.data?.key ?? ''

  const lines = useMemo(() => highlightFile(fileText), [fileText])

  const shown =
    lines.length > 1 && fileText.endsWith('\n')
      ? lines.length - 1
      : lines.length

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
    const top = (line - 1) * LINE_HEIGHT
    const bottom = top + LINE_HEIGHT + 8

    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight - 8)
      box.scrollTop = bottom - box.clientHeight + 16
  }

  const jump = (line: number, column = 1) => {
    const el = area.current

    if (!el) return
    const at = lineOffset(el.value, line) + column - 1

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

    setCursor(line)
    reveal(line)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget

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

  const fix = (problem: FileProblem) => {
    if (!problem.fix) return
    setFileText(applyFix(fileText, problem.fix))
  }

  const savedAt = (draft ?? current)?.updated_at
  const fileName = `${definition.data?.key ?? 'pipeline'}.yaml`

  const draftLabel = draft
    ? `draft v${draft.version}`
    : current
      ? `v${current.version}`
      : ''

  return (
    <>
      <div className="ye-bar">
        <BoardButton size="sm" icon="check" onClick={validate}>
          {t('features.pipelineVersionFile.editor.validate')}
        </BoardButton>
        <BoardButton
          size="sm"
          aria-haspopup="dialog"
          disabled={!current}
          onClick={() => setComparing(true)}
        >
          {current
            ? t('features.pipelineVersionFile.editor.compareWith', {
                version: current.version,
              })
            : t('features.pipelineVersionFile.editor.compare')}
        </BoardButton>
        <BoardButton variant="quiet" size="sm" onClick={format}>
          {t('features.pipelineVersionFile.editor.format')}
        </BoardButton>
        <span className="sep" aria-hidden="true" />
        {problems.length ? (
          <span className="ye-bad">
            <Icon name="warn" size={12} />
            {t('features.pipelineVersionFile.editor.problems', {
              count: problems.length,
            })}
          </span>
        ) : (
          <span className="ye-ok">
            <Icon name="check" size={12} />
            {t('features.pipelineVersionFile.editor.noProblems')}
          </span>
        )}
        <span className="muted">
          {savedAt
            ? `· ${t('features.pipelineVersionFile.editor.savedAt', {
                when: formatTime(savedAt),
              })}`
            : `· ${t('features.pipelineVersionFile.editor.notSaved')}`}
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
        <div
          className="ye-ed"
          ref={frame}
          style={{ maxHeight: 'max(240px, calc(100dvh - 360px))' }}
        >
          <div className="ye-stack">
            {lines.slice(0, shown).map((spans, index) => {
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
              onChange={(e) => setFileText(e.target.value)}
              onKeyDown={onKeyDown}
              onKeyUp={sync}
              onClick={sync}
              onSelect={sync}
            />
          </div>
        </div>
        <span id="ye-tab-hint" className="sr-only">
          {t('features.pipelineVersionFile.editor.tabHint')}
        </span>

        {problems.length ? (
          <section className="ye-prob" aria-labelledby="ye-ph">
            <div className="ye-prob-h" id="ye-ph">
              {t('features.pipelineVersionFile.editor.problemsHeading')}{' '}
              <span className="muted">
                {problems.length} ·{' '}
                {t('features.pipelineVersionFile.editor.publishBlocked')}
              </span>
            </div>
            {problems.map((problem) => (
              <div
                className="ye-prob-r"
                key={`${problem.line}:${problem.column}`}
              >
                <Icon name="warn" size={13} />
                <button
                  type="button"
                  className="ln"
                  onClick={() => jump(problem.line, problem.column)}
                >
                  {t('features.pipelineVersionFile.editor.lineCol', {
                    line: problem.line,
                    col: problem.column,
                  })}
                </button>
                <span>{problem.message}</span>
                {problem.fix ? (
                  <BoardButton size="sm" onClick={() => fix(problem)}>
                    {problem.fix.label}
                  </BoardButton>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </section>
        ) : null}
      </div>

      {comparing && current ? (
        <CompareDialog onClose={() => setComparing(false)} />
      ) : null}
    </>
  )
}
