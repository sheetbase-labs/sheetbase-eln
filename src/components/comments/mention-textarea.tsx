import * as React from 'react'

import { activeMention, insertMention, matchMentions } from '#/lib/mentions'
import type { MentionCandidate } from '#/lib/mentions'
import { cn } from '#/lib/utils'

/**
 * A comment box that offers workspace members when the caret is in an `@word`.
 * Choosing one writes `@Their Name ` into the text; the people named are worked
 * out from the finished text (see `extractMentions`), so a name typed in full
 * counts the same as one picked from the list.
 */
export function MentionTextarea({
  value,
  onChange,
  candidates,
  className,
  ...props
}: {
  value: string
  onChange: (value: string) => void
  candidates: readonly MentionCandidate[]
  className?: string
} & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
>) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = React.useState(0)
  const [index, setIndex] = React.useState(0)
  const [dismissed, setDismissed] = React.useState(false)
  const pendingCaret = React.useRef<number | null>(null)
  const listId = React.useId()

  const active = activeMention(value, caret)
  const options =
    active && !dismissed ? matchMentions(active.query, candidates) : []
  const open = options.length > 0

  function choose(candidate: MentionCandidate) {
    const next = insertMention(value, caret, candidate.name)
    if (!next) return
    onChange(next.text)
    setCaret(next.caret)
    setIndex(0)
    pendingCaret.current = next.caret
  }

  // Apply the caret after React has rendered the inserted mention. A
  // requestAnimationFrame here let a fast typist (and userEvent) type at the
  // old caret before the browser moved it, which reordered the sentence.
  React.useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    const textarea = ref.current
    if (!textarea || textarea.value !== value) return
    textarea.focus()
    textarea.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [value])

  return (
    <div className="relative">
      <textarea
        ref={ref}
        {...props}
        className={className}
        value={value}
        {...(candidates.length > 0
          ? {
              role: 'combobox',
              'aria-expanded': open,
              'aria-autocomplete': 'list' as const,
              'aria-controls': open ? listId : undefined,
            }
          : {})}
        onChange={(event) => {
          onChange(event.target.value)
          setCaret(event.target.selectionStart)
          setIndex(0)
          setDismissed(false)
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (!open) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setIndex((current) => (current + 1) % options.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setIndex(
              (current) => (current - 1 + options.length) % options.length,
            )
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            choose(options[index] ?? options[0])
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDismissed(true)
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention a teammate"
          className={cn(
            'absolute left-0 top-full z-20 mt-1 max-h-48 w-64 overflow-auto rounded-md border bg-surface p-1 shadow-md',
          )}
        >
          {options.map((candidate, position) => (
            <li
              key={candidate.userId}
              role="option"
              aria-selected={position === index}
              className={cn(
                'cursor-pointer rounded px-2 py-1 text-xs',
                position === index && 'bg-surface-muted',
              )}
              // mousedown, not click: the textarea must not lose its caret first.
              onMouseDown={(event) => {
                event.preventDefault()
                choose(candidate)
              }}
            >
              {candidate.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
