import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  extractFunctionPrefix,
  getFunctionSuggestions,
} from '#/lib/function-descriptions'
import type { FunctionSuggestion } from '#/lib/function-descriptions'

/**
 * Result of inserting a function into the formula text. The caller applies
 * `text` to the input and sets the cursor to `cursor`.
 */
export interface FunctionInsertResult {
  text: string
  cursor: number
}

/**
 * Configuration for the autocomplete behaviour.
 */
interface UseFunctionAutocompleteArgs {
  /** Current input value. */
  value: string
  /** Ref to the input/textarea element for cursor tracking and positioning. */
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  /** Called when the user accepts a suggestion. Receives the full new text and cursor. */
  onInsert: (result: FunctionInsertResult) => void
}

export interface FunctionAutocompleteState {
  /** Whether the dropdown is visible. */
  isOpen: boolean
  /** Current suggestions. */
  suggestions: FunctionSuggestion[]
  /** Index of the highlighted suggestion, or -1 if none. */
  activeIndex: number
  /** Keydown handler to spread onto the input element. */
  handleKeyDown: (event: React.KeyboardEvent) => void
  /** Accept a suggestion by index (used by mouse click). */
  selectSuggestion: (index: number) => void
  /** Ref to attach to the dropdown scroll container (for scrolling into view). */
  listRef: React.RefObject<HTMLDivElement | null>
}

/**
 * React hook that manages function-name autocomplete for a formula input.
 *
 * Detects a partial function name at the cursor position, shows matching
 * suggestions, and handles keyboard navigation (Up/Down/Tab/Enter/Escape).
 * The caller is responsible for rendering the dropdown using the returned
 * state and applying `onInsert` results to the input.
 */
export function useFunctionAutocomplete({
  value,
  inputRef,
  onInsert,
}: UseFunctionAutocompleteArgs): FunctionAutocompleteState {
  const [selection, setSelection] = useState({ value, cursor: value.length })

  const [navigation, setNavigation] = useState({
    value,
    cursor: value.length,
    index: 0,
    dismissed: false,
  })

  const listRef = useRef<HTMLDivElement>(null)
  const cursor = selection.value === value ? selection.cursor : value.length
  const prefix = extractFunctionPrefix(value, cursor)

  const currentNavigation =
    navigation.value === value && navigation.cursor === cursor

  const dismissed = currentNavigation && navigation.dismissed

  const suggestions = useMemo(
    () => (prefix && !dismissed ? getFunctionSuggestions(prefix) : []),
    [prefix, dismissed],
  )

  const activeIndex =
    suggestions.length === 0 ? -1 : currentNavigation ? navigation.index : 0

  // Observe native input/selection events, including programmatic caret moves.
  // Suggestions are derived from the draft rather than copied into effect state.
  useEffect(() => {
    const el = inputRef.current

    if (!el) return

    const updateSelection = () => {
      setSelection({
        value: el.value,
        cursor: el.selectionStart ?? el.value.length,
      })
    }

    el.addEventListener('input', updateSelection)
    el.addEventListener('select', updateSelection)
    el.addEventListener('click', updateSelection)
    el.addEventListener('keyup', updateSelection)

    return () => {
      el.removeEventListener('input', updateSelection)
      el.removeEventListener('select', updateSelection)
      el.removeEventListener('click', updateSelection)
      el.removeEventListener('keyup', updateSelection)
    }
  }, [inputRef])

  // Scroll the active item into view when navigating.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return

    const item = listRef.current.children[activeIndex]

    if (item instanceof HTMLElement) item.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const isOpen = suggestions.length > 0

  const acceptSuggestion = useCallback(
    (index: number) => {
      if (index < 0 || index >= suggestions.length || !inputRef.current) return
      const suggestion = suggestions[index]
      const el = inputRef.current
      const insertionCursor = el.selectionStart ?? value.length
      const insertionPrefix = extractFunctionPrefix(value, insertionCursor)

      if (!insertionPrefix) return
      // Walk backwards to find the token span (same logic as extractFunctionPrefix).
      let start = insertionCursor

      while (start > 0 && /[A-Za-z0-9_.]/.test(value[start - 1])) start--
      const insertText = `${suggestion.id}()`

      const newText =
        value.slice(0, start) + insertText + value.slice(insertionCursor)

      const newCursor = start + suggestion.id.length + 1 // between the parens
      setNavigation({
        value,
        cursor: insertionCursor,
        index: -1,
        dismissed: true,
      })
      onInsert({ text: newText, cursor: newCursor })
    },
    [suggestions, inputRef, value, onInsert],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (suggestions.length === 0) return

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          setNavigation({
            value,
            cursor,
            index: (activeIndex + 1) % suggestions.length,
            dismissed: false,
          })
          break
        case 'ArrowUp':
          event.preventDefault()
          setNavigation({
            value,
            cursor,
            index: activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1,
            dismissed: false,
          })
          break
        case 'Tab':
        case 'Enter':
          if (activeIndex >= 0) {
            event.preventDefault()
            acceptSuggestion(activeIndex)
          }

          break
        case 'Escape':
          event.preventDefault()
          setNavigation({ value, cursor, index: -1, dismissed: true })
          break
      }
    },
    [suggestions, activeIndex, acceptSuggestion, value, cursor],
  )

  return {
    isOpen,
    suggestions,
    activeIndex,
    handleKeyDown,
    selectSuggestion: acceptSuggestion,
    listRef,
  }
}

/**
 * Floating dropdown that renders function autocomplete suggestions below the
 * anchor input. Styled with the same shadcn/ui tokens as the Command palette.
 */
export function FunctionAutocompleteDropdown({
  suggestions,
  activeIndex,
  listRef,
  onSelect,
}: {
  suggestions: FunctionSuggestion[]
  activeIndex: number
  listRef: React.RefObject<HTMLDivElement | null>
  onSelect: (index: number) => void
}) {
  if (suggestions.length === 0) return null

  return (
    <div
      ref={listRef}
      role="listbox"
      className="absolute z-50 mt-1 max-h-64 w-72 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {suggestions.map((s, i) => (
        <button
          key={s.id}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            // Prevent the input from losing focus before the click fires.
            e.preventDefault()
            onSelect(i)
          }}
          className={`flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-xs transition-colors ${
            i === activeIndex
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          }`}
        >
          <span className="font-mono font-medium">{s.id}</span>
          <span className="text-muted-foreground">{s.description}</span>
        </button>
      ))}
    </div>
  )
}
