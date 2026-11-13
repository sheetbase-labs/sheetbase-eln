import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import type { CompletionContext } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  indentUnit,
  unfoldEffect,
} from '@codemirror/language'
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from '@codemirror/search'
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- this module is itself loaded on demand by code-editor.tsx.
import {
  Annotation,
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- this module is itself loaded on demand by code-editor.tsx.
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  drawSelection,
  gutter,
  highlightActiveLine,
  keymap,
  lineNumberMarkers,
  lineNumbers,
  placeholder as placeholderText,
} from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { useEffect, useImperativeHandle, useRef } from 'react'

import { cn } from '#/lib/utils'
import { codeEditorTheme } from './code-editor-theme'

/** A stretch of the text to colour: `kind` picks the `cm-tok-<kind>` class. */
export interface CodeToken {
  from: number
  to: number
  kind: string
}

/** A mistake in the text: marked on its line, with the message under it. */
export interface CodeProblem {
  line: number
  /** 1-based column the marked stretch starts at. */
  column: number
  length: number
  /** The bold start of the message, such as "Line 5". */
  title: string
  message: string
  fix?: { label: string; run: () => void }
}

export interface CodeSuggestions {
  /** How many characters before the caret the suggestion replaces. */
  prefixLength: number
  options: { label: string; insert: string; note?: string }[]
}

export interface CodeEditorHandle {
  focus: () => void
  /** Put the caret at a 1-based line and column and scroll it into view. */
  jump: (line: number, column?: number) => void
}

export interface CodeEditorProps {
  value: string
  onChange?: (text: string) => void
  ref?: React.Ref<CodeEditorHandle>
  ariaLabel: string
  readOnly?: boolean
  /** Colours for the text; called on every change, so keep it cheap. */
  highlight?: (text: string) => CodeToken[]
  problems?: CodeProblem[]
  /** Suggestions for the caret's line as it is typed. */
  suggest?: (
    text: string,
    line: number,
    column: number,
  ) => CodeSuggestions | null
  /** Lines at the top that stay folded to one row until the caret goes in. */
  fold?: { lines: number; label: string; ariaLabel: string }
  /** A line that starts a block: the next line is indented further. */
  indentAfter?: RegExp
  lineNumbers?: boolean
  onSave?: () => void
  onBlur?: () => void
  /** The longest text it takes; typing or pasting past it is refused. */
  maxLength?: number
  /** Shown under the suggestions list. */
  suggestFooter?: string
  minHeight?: string
  maxHeight?: string
  className?: string
  placeholder?: string
}

const fromOutside = Annotation.define<boolean>()
const setProblems = StateEffect.define<CodeProblem[]>()

class PillWidget extends WidgetType {
  constructor(readonly problem: CodeProblem) {
    super()
  }

  eq(other: PillWidget) {
    const a = this.problem
    const b = other.problem

    return (
      a.title === b.title &&
      a.message === b.message &&
      a.fix?.label === b.fix?.label
    )
  }

  toDOM() {
    const { problem } = this
    const wrap = document.createElement('div')
    const pill = document.createElement('span')
    const text = document.createElement('span')
    const bold = document.createElement('b')

    wrap.className = 'cm-bad-msg'
    pill.className = 'pill'
    pill.setAttribute('role', 'alert')
    pill.insertAdjacentHTML(
      'beforeend',
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v5M12 18h.01"/></svg>',
    )
    bold.textContent = problem.title
    text.append(bold, ` · ${problem.message}`)
    pill.append(text)

    if (problem.fix) {
      const button = document.createElement('button')

      button.type = 'button'
      button.textContent = problem.fix.label
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', () => problem.fix?.run())
      pill.append(button)
    }

    wrap.append(pill)

    return wrap
  }

  // The fix button takes its own clicks.
  ignoreEvent() {
    return true
  }
}

/** The board keeps a narrow column between the numbers and the text. */
class SpacerMarker extends GutterMarker {
  toDOM() {
    const spacer = document.createElement('span')

    spacer.style.display = 'inline-block'
    spacer.style.width = '18px'

    return spacer
  }
}

/** A line with a mistake has its number in the warning colour. */
class BadNumber extends GutterMarker {
  elementClass = 'cm-bad-number'
}

const spacer = new SpacerMarker()
const badNumber = new BadNumber()

const problemField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let effect: StateEffect<CodeProblem[]> | undefined

    for (const candidate of tr.effects)
      if (candidate.is(setProblems)) effect = candidate

    if (!effect) return tr.docChanged ? value.map(tr.changes) : value
    const { doc } = tr.state
    const ranges = []
    const lines = new Set<number>()
    const withMessage = new Set<number>()

    for (const problem of effect.value) {
      if (problem.line < 1 || problem.line > doc.lines) continue
      const line = doc.line(problem.line)
      const from = Math.min(line.from + problem.column - 1, line.to)
      const to = Math.min(from + Math.max(problem.length, 1), line.to)

      if (!lines.has(problem.line)) {
        lines.add(problem.line)
        ranges.push(Decoration.line({ class: 'cm-bad' }).range(line.from))
      }

      if (to > from)
        ranges.push(Decoration.mark({ class: 'cm-bad-range' }).range(from, to))

      if (!withMessage.has(problem.line)) {
        withMessage.add(problem.line)
        ranges.push(
          Decoration.widget({
            widget: new PillWidget(problem),
            block: true,
            side: 1,
          }).range(line.to),
        )
      }
    }

    return Decoration.set(ranges, true)
  },
  provide: (field) => EditorView.decorations.from(field),
})

const problemGutter = [
  gutter({ class: 'cm-bad-gutter', initialSpacer: () => spacer }),
  lineNumberMarkers.compute([problemField], (state) => {
    const marks: Array<ReturnType<typeof badNumber.range>> = []

    state
      .field(problemField)
      .between(0, state.doc.length, (from, _to, value) => {
        if (value.spec.class === 'cm-bad') marks.push(badNumber.range(from))
      })

    return RangeSet.of(marks, true)
  }),
]

/** The text from the first change to the last, so a swap keeps the caret. */
function changeBetween(from: string, to: string) {
  let start = 0

  while (start < from.length && start < to.length && from[start] === to[start])
    start++
  let endFrom = from.length
  let endTo = to.length

  while (
    endFrom > start &&
    endTo > start &&
    from[endFrom - 1] === to[endTo - 1]
  ) {
    endFrom--
    endTo--
  }

  return { from: start, to: endFrom, insert: to.slice(start, endTo) }
}

/** Whether the first line is a folded block. */
function startsFolded(state: EditorState) {
  let folded = false

  foldedRanges(state).between(0, 0, (from) => {
    if (from === 0) folded = true
  })

  return folded
}

function tokenDecorations(tokens: CodeToken[]) {
  return Decoration.set(
    tokens.flatMap((token) =>
      token.to > token.from
        ? [
            Decoration.mark({ class: `cm-tok-${token.kind}` }).range(
              token.from,
              token.to,
            ),
          ]
        : [],
    ),
    true,
  )
}

/**
 * A code editor on CodeMirror 6, dressed in the board's frame: line numbers,
 * the line with the caret tinted, a mistake marked on its line with the message
 * and fix under it, suggestions as a list, a header that folds, find (Ctrl+F),
 * real selection, copy, paste and undo. The owner keeps the text: it is passed
 * in as `value` and every edit comes back through `onChange`.
 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function, react-doctor/no-giant-component -- one place builds the editor and keeps it in step with its props.
export function CodeEditorView({
  value,
  onChange,
  ref,
  ariaLabel,
  readOnly,
  highlight,
  problems,
  suggest,
  fold,
  indentAfter,
  lineNumbers: numbered = true,
  onSave,
  onBlur,
  maxLength,
  suggestFooter,
  minHeight = '240px',
  maxHeight,
  className,
  placeholder,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  // What the editor calls back is read at the moment it is needed.
  const live = useRef({
    onChange,
    onBlur,
    highlight,
    suggest,
    onSave,
    fold,
    indentAfter,
  })

  useEffect(() => {
    live.current = {
      onChange,
      onBlur,
      highlight,
      suggest,
      onSave,
      fold,
      indentAfter,
    }
  })

  const unfolded = useRef(false)

  const first = useRef({
    value,
    ariaLabel,
    readOnly,
    placeholder,
    numbered,
    maxLength,
  })

  useEffect(() => {
    const parent = host.current

    if (!parent) return
    const start = first.current

    const colour = StateField.define<DecorationSet>({
      create: (state) =>
        tokenDecorations(live.current.highlight?.(state.doc.toString()) ?? []),
      update: (previous, tr) =>
        tr.docChanged
          ? tokenDecorations(
              live.current.highlight?.(tr.state.doc.toString()) ?? [],
            )
          : previous,
      provide: (field) => EditorView.decorations.from(field),
    })

    const source = (context: CompletionContext) => {
      const found = live.current.suggest
      const line = context.state.doc.lineAt(context.pos)

      if (!found) return null

      const result = found(
        context.state.doc.toString(),
        line.number,
        context.pos - line.from + 1,
      )

      if (!result || !result.options.length) return null

      return {
        from: context.pos - result.prefixLength,
        filter: false,
        options: result.options.map((option) => ({
          label: option.label,
          detail: option.note,
          apply: option.insert,
        })),
      }
    }

    const enter = (target: EditorView) => {
      if (target.state.readOnly) return false
      const after = live.current.indentAfter

      target.dispatch(
        target.state.update(
          target.state.changeByRange((range) => {
            const line = target.state.doc.lineAt(range.head)
            const before = line.text.slice(0, range.head - line.from)
            const indent = /^ */.exec(before)?.[0] ?? ''

            const opens =
              !!after &&
              after.test(before) &&
              !before.trimStart().startsWith('#')

            const text = `\n${indent}${opens ? '  ' : ''}`

            return {
              changes: { from: range.from, to: range.to, insert: text },
              range: EditorSelection.cursor(range.from + text.length),
            }
          }),
          { scrollIntoView: true, userEvent: 'input' },
        ),
      )

      return true
    }

    const next = new EditorView({
      parent,
      state: EditorState.create({
        doc: start.value,
        extensions: [
          codeEditorTheme,
          start.numbered
            ? lineNumbers({
                // The folded header is one row: it carries no number.
                formatNumber: (n, state) =>
                  n === 1 && startsFolded(state) ? '' : String(n),
              })
            : [],
          start.numbered ? problemGutter : [],
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          closeBrackets(),
          indentUnit.of('  '),
          EditorState.tabSize.of(2),
          EditorState.readOnly.of(!!start.readOnly),
          EditorView.editable.of(!start.readOnly),
          search({ top: true }),
          codeFolding({
            placeholderDOM: (_view, onclick) => {
              const button = document.createElement('button')

              button.type = 'button'
              button.className = 'cm-foldPlaceholder'
              button.textContent = live.current.fold?.label ?? '…'
              button.setAttribute(
                'aria-label',
                live.current.fold?.ariaLabel ?? '',
              )
              button.addEventListener('click', (event) => {
                unfolded.current = true
                onclick(event)
              })

              return button
            },
          }),
          autocompletion({
            override: [source],
            icons: false,
            tooltipClass: () => 'cm-code-suggest',
          }),
          problemField,
          colour,
          Prec.highest(
            keymap.of([
              { key: 'Tab', run: acceptCompletion },
              {
                key: 'Mod-s',
                preventDefault: true,
                run: () => {
                  live.current.onSave?.()

                  return true
                },
              },
              {
                key: 'Escape',
                // Escape then Tab leaves the editor, as in a plain field.
                run: (target) => {
                  target.setTabFocusMode(2000)

                  return false
                },
              },
              { key: 'Enter', run: enter },
            ]),
          ),
          keymap.of([
            ...completionKeymap,
            ...closeBracketsKeymap,
            ...searchKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.contentAttributes.of({
            'aria-label': start.ariaLabel,
            spellcheck: 'false',
            autocapitalize: 'off',
            autocorrect: 'off',
          }),
          start.placeholder ? placeholderText(start.placeholder) : [],
          start.maxLength === undefined
            ? []
            : EditorState.transactionFilter.of((tr) =>
                tr.docChanged &&
                tr.newDoc.length > (start.maxLength ?? 0) &&
                tr.newDoc.length > tr.startState.doc.length
                  ? []
                  : tr,
              ),
          EditorView.domEventHandlers({
            blur: () => {
              live.current.onBlur?.()
            },
          }),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(fromOutside))
            )
              live.current.onChange?.(update.state.doc.toString())

            // The caret going into the folded header opens it.
            if (update.selectionSet && !update.docChanged) {
              const head = update.state.selection.main.head
              const folded = foldedRanges(update.state)

              folded.between(head, head, (from, to) => {
                if (head >= from && head <= to) {
                  unfolded.current = true
                  update.view.dispatch({
                    effects: unfoldEffect.of({ from, to }),
                  })
                }
              })
            }
          }),
        ],
      }),
    })

    view.current = next

    return () => {
      next.destroy()
      view.current = null
    }
  }, [])

  // The text is the owner's: a change that did not come from typing is put in
  // as one edit, so undo and the caret behave.
  useEffect(() => {
    const target = view.current

    if (!target) return
    const now = target.state.doc.toString()

    if (now === value) return

    target.dispatch({
      changes: changeBetween(now, value),
      annotations: [
        fromOutside.of(true),
        // The first text to arrive is where history starts.
        Transaction.addToHistory.of(now !== ''),
      ],
    })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: setProblems.of(problems ?? []) })
  }, [problems, value])

  // The header folds to a row until the caret or a mistake is in it.
  const foldLines = fold?.lines ?? 0
  const foldLabel = fold?.label

  useEffect(() => {
    const target = view.current

    if (!target) return
    const doc = target.state.doc
    const folded = foldedRanges(target.state)
    const ranges: Array<{ from: number; to: number }> = []

    folded.between(0, doc.length, (from, to) => {
      ranges.push({ from, to })
    })

    if (foldLines >= 1 && foldLines < doc.lines && !unfolded.current) {
      if (!ranges.length)
        target.dispatch({
          effects: foldEffect.of({ from: 0, to: doc.line(foldLines).to }),
        })
    } else if (ranges.length)
      target.dispatch({ effects: ranges.map((r) => unfoldEffect.of(r)) })
  }, [foldLines, foldLabel, value])

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    jump: (line, column = 1) => {
      const target = view.current

      if (!target) return

      const at = target.state.doc.line(
        Math.min(Math.max(line, 1), target.state.doc.lines),
      )

      const head = Math.min(at.from + column - 1, at.to)

      target.focus()
      target.dispatch({
        selection: { anchor: head },
        effects: EditorView.scrollIntoView(head, { y: 'center' }),
      })
    },
  }))

  return (
    <div
      ref={host}
      className={cn('code-editor', className)}
      style={{
        minHeight,
        maxHeight,
        display: 'flex',
        border: '1px solid var(--border)',
        borderRadius: 8,
        // The suggestion list's footer line, set from the owner's copy.
        // SAFETY: a CSS custom property is not in React's style type; the one name is checked here.
        ...(suggestFooter
          ? ({
              '--cm-hint-footer': JSON.stringify(suggestFooter),
            } as React.CSSProperties)
          : null),
      }}
    />
  )
}
