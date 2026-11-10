import { useEffect, useRef, useState } from 'react'
import { t } from '#/copy'
import { Input } from '#/components/ui/input'
import { normalizeExponentiation } from '#/lib/formula-ir'
import { toA1 } from './formula-references'
import {
  FunctionAutocompleteDropdown,
  useFunctionAutocomplete,
} from './function-autocomplete'

export function ScientificFormulaBar({
  display,
  selected,
  coords,
  status,
  onCommit,
  onStatusClear,
}: {
  display: string
  selected: boolean
  coords: { row: number; col: number } | null
  status: string
  onCommit: (source: string) => Promise<void>
  onStatusClear: () => void
}) {
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(
    null,
  )

  const source = draft?.base === display ? draft.text : display
  const [exponentHint, setExponentHint] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const autocomplete = useFunctionAutocomplete({
    value: source,
    inputRef,
    onInsert: ({ text, cursor }) => {
      setDraft({ base: display, text })
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.setSelectionRange(cursor, cursor)
      })
    },
  })

  useEffect(() => {
    if (!exponentHint) return
    const timer = setTimeout(() => setExponentHint(false), 4000)

    return () => clearTimeout(timer)
  }, [exponentHint])

  return (
    <section
      aria-label={t('notebook.scientificSheetBlock.formulaBarAriaLabel')}
      className="mb-2 flex items-center gap-1.5 border-y bg-surface-muted/20 px-3 py-2 text-xs"
    >
      <span
        className="flex h-5 w-12 shrink-0 items-center justify-center rounded bg-surface font-mono text-[10px] font-semibold text-fg-muted"
        aria-label={t(
          'notebook.scientificSheetBlock.activeCellAddressAriaLabel',
        )}
      >
        {coords ? toA1(coords.row, coords.col) : ''}
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-muted font-mono text-[10px] font-semibold italic text-fg-muted">
        fx
      </span>
      <div className="relative flex-1">
        <Input
          ref={inputRef}
          aria-label={t('notebook.scientificSheetBlock.formulaSourceAriaLabel')}
          placeholder={
            selected ? '' : t('notebook.scientificSheetBlock.placeholder')
          }
          value={source}
          disabled={!selected}
          onChange={(event) =>
            setDraft({ base: display, text: event.target.value })
          }
          onKeyDown={(event) => {
            autocomplete.handleKeyDown(event)

            if (event.defaultPrevented) return

            if (event.key === 'Enter') {
              event.preventDefault()
              const normalized = normalizeExponentiation(source)

              if (normalized !== source) {
                setDraft({ base: display, text: normalized })
                setExponentHint(true)
              }

              void onCommit(normalized)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              onStatusClear()
            }
          }}
          className="h-6 min-w-40 flex-1 border-muted font-mono text-xs"
        />
        <FunctionAutocompleteDropdown
          suggestions={autocomplete.suggestions}
          activeIndex={autocomplete.activeIndex}
          listRef={autocomplete.listRef}
          onSelect={autocomplete.selectSuggestion}
        />
      </div>
      {exponentHint ? (
        <span
          role="status"
          className="shrink-0 text-[10px] text-fg-muted italic"
        >
          {t('notebook.scientificSheetBlock.convertedTo')}
        </span>
      ) : null}
      {status ? (
        <span role="status" className="text-fg-muted">
          {status}
        </span>
      ) : null}
    </section>
  )
}
