/**
 * Host-side mapping from resolved extension panels to inspector tabs.
 *
 * Kept apart from the renderers so the slots module exports components only.
 * `renderContent` is host-owned: the host decides which installed extension
 * keys it can actually render (today only the sample) and returns null for
 * anything else, so unknown extension code never mounts.
 */
import type * as React from 'react'

import type { InspectorTab } from '#/components/record'
import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'

export function toExtensionPanelTabs(
  panels: readonly ResolvedExtensionContribution[],
  renderContent: (panel: ResolvedExtensionContribution) => React.ReactNode,
): InspectorTab[] {
  const tabs: InspectorTab[] = []

  for (const panel of panels) {
    const content = renderContent(panel)

    if (!content) continue

    tabs.push({
      id: `extension-${panel.extensionKey}-${panel.id}`,
      label: panel.title,
      content,
    })
  }

  return tabs
}
