import { Icon } from '#/components/icons'
import { useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

import { t } from '#/copy'
import { cn } from '#/lib/utils'
import { ASSISTANT_MAX_QUESTION_CHARS } from '#/lib/assistant-chat'

/**
 * The message box, after the AI Elements `PromptInput`: one rounded field that
 * grows with the text, Enter to send, Shift+Enter for a new line, and a send
 * button that becomes a stop button while an answer is on its way.
 */
export function PromptBox({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  busy: boolean
  disabled: boolean
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow with the text up to a cap, then scroll.
  useLayoutEffect(() => {
    const element = ref.current

    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }, [value])

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return
    event.preventDefault()

    if (!busy && !disabled && value.trim() !== '') onSubmit()
  }

  const canSend = !disabled && !busy && value.trim() !== ''

  return (
    <form
      className={cn(
        'flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-sm transition-colors',
        'focus-within:border-border-strong focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus',
        disabled && 'bg-surface-disabled',
      )}
      onSubmit={(event) => {
        event.preventDefault()

        if (canSend) onSubmit()
      }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        maxLength={ASSISTANT_MAX_QUESTION_CHARS}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={t('notebook.assistantPanel.messageLabel')}
        data-testid="assistant-question"
        className="max-h-40 min-h-8 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-body text-fg outline-none placeholder:text-fg-faint disabled:text-fg-muted"
      />
      {busy ? (
        <button
          type="button"
          onClick={onStop}
          aria-label={t('notebook.assistantPanel.stop')}
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-fg hover:bg-surface-hover"
        >
          <Icon name="square" size={12} fill="currentColor" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t('notebook.assistantPanel.ask')}
          data-testid="assistant-ask"
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-default disabled:border-border disabled:bg-surface-disabled disabled:text-fg-faint"
        >
          <Icon name="arrowUp" size={16} />
        </button>
      )}
    </form>
  )
}
