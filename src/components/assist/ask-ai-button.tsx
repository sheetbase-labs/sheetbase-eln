import { Button } from '#/components/v3/ui/button'
import { usePlatform } from '#/lib/use-platform'
import { formatShortcut } from '#/lib/shortcuts'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { openAssistant } from '#/lib/assistant-context'

/**
 * One in-context entry point. It dispatches the shared open event rather than
 * owning assistant state, so a page header can mount it without threading a
 * provider through every route.
 */
export function AskAiButton({ className }: { className?: string }) {
  return (
    <Tooltip content="Ask AI about this page">
      <Button
        variant="quiet"
        size="icon"
        icon="spark"
        aria-label="Ask AI about this page"
        data-testid="ask-ai-button"
        className={className}
        onClick={() => openAssistant()}
      />
    </Tooltip>
  )
}

/** The shell-level trigger, next to search and help. */
export function AssistantTrigger({ className }: { className?: string }) {
  const platform = usePlatform()
  return (
    <Tooltip content={`Ask AI (${formatShortcut('mod+j', platform)})`}>
      <Button
        variant="quiet"
        size="icon"
        icon="spark"
        aria-label="Ask AI"
        aria-keyshortcuts="Meta+J Control+J"
        data-testid="assistant-trigger"
        className={className}
        onClick={() => openAssistant()}
      />
    </Tooltip>
  )
}
