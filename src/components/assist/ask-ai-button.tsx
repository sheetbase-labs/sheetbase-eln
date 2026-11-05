import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { usePlatform } from '#/lib/use-platform'
import { formatShortcut } from '#/lib/shortcuts'
import { Tooltip } from '#/components/ui/tooltip'
import { openAssistant } from '#/lib/assistant-context'
import { cn } from '#/lib/utils'
import { usePageAi } from '#/lib/use-page-ai'

/**
 * One in-context entry point. It dispatches the shared open event rather than
 * owning assistant state, so a page header can mount it without threading a
 * provider through every route.
 */
export function AskAiButton({ className }: { className?: string }) {
  const { available } = usePageAi()
  if (!available) return null
  return (
    <Tooltip content={t('notebook.askAiButton.label')}>
      <Button
        variant="quiet"
        size="icon"
        icon="spark"
        aria-label={t('notebook.askAiButton.label')}
        data-testid="ask-ai-button"
        // On a phone the assistant opens from the top bar, so the
        // page header keeps its room for the page's own actions.
        className={cn('max-md:hidden', className)}
        onClick={() => openAssistant()}
      />
    </Tooltip>
  )
}

/** The shell-level trigger in the top bar, beside help and the bell, on
 * every screen size. */
export function AssistantTrigger({ className }: { className?: string }) {
  const platform = usePlatform()
  const { available } = usePageAi()
  if (!available) return null
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
