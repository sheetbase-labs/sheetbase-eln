import type { ComponentProps, HTMLAttributes } from 'react'
import { memo } from 'react'
import { Streamdown } from 'streamdown'

import { cn } from '#/lib/utils'

/**
 * One turn in the conversation, after the AI Elements `Message`. The person's
 * words sit in a soft bubble on the right; the assistant's answer runs flat on
 * the page, as Markdown, like every modern chat.
 */
export function Message({
  className,
  from,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: 'user' | 'assistant' }) {
  return (
    <div
      data-from={from}
      className={cn(
        'group flex w-full min-w-0 flex-col gap-1.5',
        from === 'user' ? 'is-user items-end' : 'is-assistant items-start',
        className,
      )}
      {...props}
    />
  )
}

export function MessageContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex min-w-0 max-w-full flex-col gap-2 text-body text-fg',
        'group-[.is-user]:max-w-[88%] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-surface-muted group-[.is-user]:px-3.5 group-[.is-user]:py-2 group-[.is-user]:whitespace-pre-wrap',
        'group-[.is-assistant]:w-full',
        className,
      )}
      {...props}
    />
  )
}

/** Markdown that tolerates half-finished text while it streams. */
export const MessageResponse = memo(
  ({ className, ...props }: ComponentProps<typeof Streamdown>) => (
    <Streamdown
      className={cn(
        'assistant-markdown text-body leading-6 text-fg [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      controls={false}
      {...props}
    />
  ),
  (prev, next) =>
    prev.children === next.children && next.isAnimating === prev.isAnimating,
)

MessageResponse.displayName = 'MessageResponse'

export function MessageActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-1', className)} {...props} />
}
