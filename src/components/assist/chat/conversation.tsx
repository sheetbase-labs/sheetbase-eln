import { Icon } from '#/components/icons'
import type { ComponentProps } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'

import { t } from '#/copy'
import { cn } from '#/lib/utils'

/**
 * The scrolling message list, after the AI Elements `Conversation`: it follows
 * the newest text while an answer streams, stops following when the person
 * scrolls up to read, and offers a way back down.
 */
export function Conversation({
  className,
  ...props
}: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cn('relative min-h-0 flex-1 overflow-y-hidden', className)}
      initial="instant"
      resize="smooth"
      role="log"
      {...props}
    />
  )
}

export function ConversationContent({
  className,
  ...props
}: ComponentProps<typeof StickToBottom.Content>) {
  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-5 px-4 py-4', className)}
      {...props}
    />
  )
}

export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  if (isAtBottom) return null

  return (
    <button
      type="button"
      onClick={() => scrollToBottom()}
      aria-label={t('notebook.assistantPanel.scrollToLatest')}
      className="absolute bottom-3 left-1/2 inline-flex size-8 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-fg shadow-sm hover:bg-surface-hover"
    >
      <Icon name="arrowDown" size={14} />
    </button>
  )
}
