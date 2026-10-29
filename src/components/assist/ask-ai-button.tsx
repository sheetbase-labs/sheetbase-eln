import { t } from '#/copy'
import { Button } from '#/components/v3/ui/button'
import { usePlatform } from '#/lib/use-platform'
import { formatShortcut } from '#/lib/shortcuts'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { openAssistant } from '#/lib/assistant-context'
import { cn } from '#/lib/utils'

/**
 * One in-context entry point. It dispatches the shared open event rather than
 * owning assistant state, so a page header can mount it without threading a
 * provider through every route.
 */
export function AskAiButton({ className }: { className?: string }) {
  return (
    <Tooltip content={t('notebook.askAiButton.label')}>
      <Button
        variant="quiet"
        size="icon"
        icon="spark"
        aria-label={t('notebook.askAiButton.label')}
        data-testid="ask-ai-button"
        // On a phone the assistant opens from the navigation drawer, so the
        // page header keeps its room for the page's own actions.
        className={cn('max-md:hidden', className)}
        onClick={() => openAssistant()}
      />
    </Tooltip>
  )
}

/** The shell-level trigger, next to search and help. */
export function AssistantTrigger({ className }: { className?: string }) {
  const platform = usePlatform()
  return (
    <Tooltip
      content={t('notebook.askAiButton.withShortcut', {
        shortcut: formatShortcut('mod+j', platform),
      })}
    >
      <Button
        variant="quiet"
        size="icon"
        icon="spark"
        aria-label={t('notebook.askAiButton.ariaLabel')}
        aria-keyshortcuts="Meta+J Control+J"
        data-testid="assistant-trigger"
        className={className}
        onClick={() => openAssistant()}
      />
    </Tooltip>
  )
}
