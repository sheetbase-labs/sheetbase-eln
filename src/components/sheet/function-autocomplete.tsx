import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const [suggestions, setSuggestions] = useState<FunctionSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Recompute suggestions whenever the value or cursor changes.
  const computeSuggestions = useCallback(() => {
    const el = inputRef.current
    const cursor = el?.selectionStart ?? value.length
    const prefix = extractFunctionPrefix(value, cursor)
    if (!prefix) {
      setSuggestions([])
      setActiveIndex(-1)
      return
    }
    const matches = getFunctionSuggestions(prefix)
    setSuggestions(matches)
    setActiveIndex(matches.length > 0 ? 0 : -1)
  }, [value, inputRef])

  // Debounce-free: formula inputs are short and suggestions are cheap.
  useLayoutEffect(() => {
    computeSuggestions()
  }, [computeSuggestions])

  // Scroll the active item into view when navigating.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return
    const item = listRef.current.children[activeIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const isOpen = suggestions.length > 0

  const acceptSuggestion = useCallback(
    (index: number) => {
      if (index < 0 || index >= suggestions.length || !inputRef.current) return
      const suggestion = suggestions[index]
      const el = inputRef.current
      const cursor = el.selectionStart ?? value.length
      const prefix = extractFunctionPrefix(value, cursor)
      if (!prefix) return
      // Walk backwards to find the token span (same logic as extractFunctionPrefix).
      let start = cursor
      while (start > 0 && /[A-Za-z0-9_.]/.test(value[start - 1])) start--
      const insertText = `${suggestion.id}(`
      const newText = value.slice(0, start) + insertText + value.slice(cursor)
      const newCursor = start + insertText.length
      setSuggestions([])
      setActiveIndex(-1)
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
          setActiveIndex((i) => (i + 1) % suggestions.length)
          break
        case 'ArrowUp':
          event.preventDefault()
          setActiveIndex((i) =>
            i <= 0 ? suggestions.length - 1 : i - 1,
          )
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
          setSuggestions([])
          setActiveIndex(-1)
          break
      }
    },
    [suggestions, activeIndex, acceptSuggestion],
  )

  return { isOpen, suggestions, activeIndex, handleKeyDown, selectSuggestion: acceptSuggestion, listRef }
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
