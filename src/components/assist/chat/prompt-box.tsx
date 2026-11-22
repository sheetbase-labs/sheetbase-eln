import { Icon } from '#/components/icons'
import { useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'

import { t } from '#/copy'
import { cn } from '#/lib/utils'
import { ASSISTANT_MAX_QUESTION_CHARS } from '#/lib/assistant-chat'
import { attachmentRef } from '#/lib/assistant-attachments'
import type { ChatAttachment } from '#/lib/assistant-attachments'
import { AttachmentChips } from './attachment-chips'

/** Files the box can take: dropped, pasted or picked. Leave out for a box with none. */
export interface PromptBoxFiles {
  /** Files waiting to go with the next question. */
  waiting: ChatAttachment[]
  /** Names being read. */
  reading: string[]
  error: string | null
  onAdd: (files: File[]) => void
  onRemove: (id: string) => void
}

/** What the picker offers: the kinds the reader takes. */
const FILE_ACCEPT =
  '.csv,.tsv,.txt,.xlsx,.xls,.pdf,.docx,.doc,.pptx,.odt,.json,image/png,image/jpeg,image/webp'

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
  files,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  busy: boolean
  disabled: boolean
  placeholder: string
  files?: PromptBoxFiles
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

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

    if (canSend) onSubmit()
  }

  const hasFiles = (files?.waiting.length ?? 0) > 0
  // A question can go with only a file: the box then asks for the obvious.
  const canSend = !disabled && !busy && (value.trim() !== '' || hasFiles)

  function onDragOver(event: DragEvent<HTMLFormElement>) {
    if (!files || disabled || !event.dataTransfer.types.includes('Files'))
      return
    event.preventDefault()
    setDragging(true)
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    setDragging(false)

    if (!files || disabled || event.dataTransfer.files.length === 0) return
    event.preventDefault()
    files.onAdd([...event.dataTransfer.files])
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...event.clipboardData.files]

    if (!files || disabled || pasted.length === 0) return
    event.preventDefault()
    files.onAdd(pasted)
  }

  return (
    <form
      className={cn(
        'relative flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-2 shadow-sm transition-colors',
        dragging && 'border-primary bg-surface-muted',
        'focus-within:border-border-strong focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus',
        disabled && 'bg-surface-disabled',
      )}
      onSubmit={(event) => {
        event.preventDefault()

        if (canSend) onSubmit()
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {files ? (
        <AttachmentChips
          files={files.waiting.map(attachmentRef)}
          reading={files.reading}
          onRemove={files.onRemove}
          className="px-1 pt-0.5"
        />
      ) : null}
      <div className="flex items-end gap-2">
        {files ? (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="assistant-file-input"
              onChange={(event) => {
                files.onAdd([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => picker.current?.click()}
              aria-label={t('features.labFiles.attach.button')}
              title={t('features.labFiles.attach.hint')}
              data-testid="assistant-attach"
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-fg-muted transition-[color,background-color,scale] duration-150 ease-out hover:bg-surface-hover hover:text-fg active:scale-[.97] disabled:cursor-default disabled:text-fg-faint"
            >
              <Icon name="paperclip" size={16} />
            </button>
          </>
        ) : null}
        <textarea
          ref={ref}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
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
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-fg transition-[background-color,scale] duration-150 ease-out hover:bg-surface-hover active:scale-[.97]"
          >
            <Icon name="square" size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label={t('notebook.assistantPanel.ask')}
            data-testid="assistant-ask"
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground transition-[color,background-color,scale] duration-150 ease-out hover:bg-primary-hover active:scale-[.97] disabled:active:scale-100 disabled:cursor-default disabled:border-border disabled:bg-surface-disabled disabled:text-fg-faint"
          >
            <Icon name="arrowUp" size={16} />
          </button>
        )}
      </div>
      {files?.error ? (
        <p role="alert" className="m-0 px-1 text-label text-danger-text">
          {files.error}
        </p>
      ) : null}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-surface-muted/90 text-body font-medium text-fg">
          {t('features.labFiles.attach.dropHere')}
        </div>
      ) : null}
    </form>
  )
}
