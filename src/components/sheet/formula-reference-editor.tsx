import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpreadsheetCustomEditorContext } from '@sheetbase-labs/sheetbase-table'
import { t } from '#/copy'
import { normalizeExponentiation } from '#/lib/formula-ir'
import {
  FunctionAutocompleteDropdown,
  useFunctionAutocomplete,
} from './function-autocomplete'
import {
  GRID_CANVAS_SELECTOR,
  ReferencePicker,
  createReferenceGridHost,
  toA1,
} from './formula-references'
import type { ReferenceGridHost } from './formula-references'

const ARROW_DELTAS = new Map([
  ['ArrowUp', { row: -1, col: 0 }],
  ['ArrowDown', { row: 1, col: 0 }],
  ['ArrowLeft', { row: 0, col: -1 }],
  ['ArrowRight', { row: 0, col: 1 }],
])

export type FormulaReferenceEditorCellProps = Pick<
  SpreadsheetCustomEditorContext,
  'point' | 'initialDraft' | 'commit' | 'cancel'
>

/** In-cell formula entry with pointer/range picking and function autocomplete. */
export function FormulaReferenceEditorCell({
  point,
  initialDraft,
  commit,
  cancel,
}: FormulaReferenceEditorCellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hostRef = useRef<ReferenceGridHost | null>(null)
  const pickerRef = useRef<ReferencePicker | null>(null)
  const valueRef = useRef(initialDraft)
  const closedRef = useRef(false)
  const cursorRef = useRef({ row: point.row, col: point.column })
  const anchorRef = useRef<{ row: number; col: number } | null>(null)
  const lastRefRef = useRef<{ textStart: number; textEnd: number } | null>(null)
  const [value, setValue] = useState(initialDraft)

  const refocus = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  // Update the DOM synchronously so the next reference pick reads the new caret.
  const writeDraft = useCallback((next: string, cursor?: number) => {
    const el = inputRef.current
    valueRef.current = next

    if (el) {
      el.value = next

      if (cursor !== undefined) el.setSelectionRange(cursor, cursor)
    }

    setValue(next)
  }, [])

  const insertReference = useCallback(
    (a1: string) => {
      const el = inputRef.current

      if (!el) return
      const current = valueRef.current
      const start = el.selectionStart ?? current.length
      const end = el.selectionEnd ?? current.length
      writeDraft(
        current.slice(0, start) + a1 + current.slice(end),
        start + a1.length,
      )
    },
    [writeDraft],
  )

  const autocomplete = useFunctionAutocomplete({
    value,
    inputRef,
    onInsert: ({ text, cursor }) => writeDraft(text, cursor),
  })

  const finish = useCallback(
    (next: string | null) => {
      if (closedRef.current) return
      closedRef.current = true

      if (next === null) cancel()
      else commit(normalizeExponentiation(next))
    },
    [cancel, commit],
  )

  useEffect(() => {
    const el = inputRef.current
    const canvas = el?.closest<HTMLElement>(GRID_CANVAS_SELECTOR)

    if (!el || !canvas) return
    const host = createReferenceGridHost(canvas)
    hostRef.current = host

    const picker = new ReferencePicker(host, {
      getSheetName: () => '',
      insertReference,
      refocusEditor: refocus,
    })

    pickerRef.current = picker

    const onPointerDown = (event: PointerEvent) => {
      if (!valueRef.current.startsWith('=')) return
      picker.onPointerDown(event)
    }

    const onMouseDown = (event: MouseEvent) => {
      if (!valueRef.current.startsWith('=')) return
      picker.suppressMouseDown(event)
    }

    const doc = host.rootDocument
    doc.addEventListener('pointerdown', onPointerDown, true)
    doc.addEventListener('mousedown', onMouseDown, true)
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)

    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.removeEventListener('mousedown', onMouseDown, true)
      picker.abortDrag()
      picker.clearAllHighlights()
      pickerRef.current = null
      hostRef.current = null
    }
  }, [insertReference, refocus])

  const handleReferenceKeyDown = (event: React.KeyboardEvent) => {
    if (!valueRef.current.startsWith('=')) return
    const delta = ARROW_DELTAS.get(event.key)

    if (!delta) return

    if (event.altKey || event.ctrlKey || event.metaKey) return

    if (event.nativeEvent.isComposing) return

    if (autocomplete.isOpen) return
    const picker = pickerRef.current
    const host = hostRef.current
    const el = inputRef.current

    if (!picker || !host || !el) return
    const cursor = cursorRef.current
    const next = { row: cursor.row + delta.row, col: cursor.col + delta.col }

    if (
      next.row < 0 ||
      next.row >= host.countRows() ||
      next.col < 0 ||
      next.col >= host.countCols()
    )
      return
    event.preventDefault()
    const anchor = event.shiftKey ? (anchorRef.current ?? cursor) : null
    anchorRef.current = anchor
    cursorRef.current = next

    // Consecutive arrow picks replace the previous reference, unless typing or
    // moving the caret has broken the chain.
    const lastRef = lastRefRef.current
    let insertPoint: number

    if (lastRef && el.selectionStart === lastRef.textEnd) {
      picker.popLastReference()
      el.setSelectionRange(lastRef.textStart, lastRef.textEnd)
      insertPoint = lastRef.textStart
    } else {
      insertPoint = el.selectionStart ?? valueRef.current.length
    }

    if (anchor) picker.pickRange(anchor.row, anchor.col, next.row, next.col)
    else picker.pickCell(next.row, next.col)
    lastRefRef.current = {
      textStart: insertPoint,
      textEnd: el.selectionStart ?? insertPoint,
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        className="sheetbase-formula-editor"
        aria-label={t('notebook.formulaReferenceEditor.ariaLabel', {
          toA1: toA1(point.row, point.column),
        })}
        defaultValue={initialDraft}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          valueRef.current = event.target.value
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          autocomplete.handleKeyDown(event)

          if (event.defaultPrevented) return

          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            finish(valueRef.current)

            return
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            finish(null)

            return
          }

          handleReferenceKeyDown(event)
        }}
        onBlur={(event) => {
          // Dropdown controls keep the edit open; leaving commits only once.
          const next = event.relatedTarget

          if (next && event.currentTarget.parentElement?.contains(next)) return
          finish(valueRef.current)
        }}
      />
      <FunctionAutocompleteDropdown
        suggestions={autocomplete.suggestions}
        activeIndex={autocomplete.activeIndex}
        listRef={autocomplete.listRef}
        onSelect={autocomplete.selectSuggestion}
      />
    </>
  )
}
