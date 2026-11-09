/**
 * What plugins said while letting a save through. The data proxy puts their
 * words in a response header (URL-encoded, joined with ` | `); the data client
 * shows them once, so a warning is seen when the save happens instead of only
 * living in a header nobody reads.
 */
import { toast } from '#/components/ui/sonner'
import { t } from '#/copy'

import { PLUGIN_WARNINGS_HEADER } from './plugin-warnings-header'

/** The warnings a response carries, in the order the plugins gave them. */
export function pluginWarningsOf(response: Response): string[] {
  const raw = response.headers.get(PLUGIN_WARNINGS_HEADER)

  if (!raw) return []

  try {
    return decodeURIComponent(raw)
      .split(' | ')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Shows each warning as a notice. Does nothing outside a browser. The save's
 * own confirmation appears a moment after the response; waiting briefly puts
 * the warning in front of it instead of behind.
 */
export function announcePluginWarnings(response: Response): void {
  if (typeof window === 'undefined') return
  const warnings = pluginWarningsOf(response)

  if (warnings.length === 0) return
  window.setTimeout(() => {
    for (const message of warnings)
      toast.warning(t('plugins.recordPanel.warned', { message }), {
        duration: 10_000,
      })
  }, 600)
}
