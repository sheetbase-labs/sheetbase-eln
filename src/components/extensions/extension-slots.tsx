/**
 * EXT-02 contributed-UI slots.
 *
 * The three renderers every host surface shares for resolved extension
 * contributions. All render through existing primitives with host-matching
 * labels and focus behaviour — extensions supply only id/title, never
 * markup:
 *
 * - `ExtensionObjectActions`: ghost buttons for record/dataset action rows
 *   (same `size="sm"` rhythm as the neighbouring Duplicate/Submit
 *   controls). Renders nothing when there are no actions.
 * - `ExtensionCommandGroup`: an "Extensions" group inside the ⌘K palette,
 *   mounted exactly like the Favourites/Projects additive groups — absent
 *   while empty, never an error surface.
 * - `toExtensionPanelTabs`: maps resolved panels onto `InspectorTab`s the
 *   host appends to its own tabs; the host owns the content renderer
 *   (today: the sample panel), so extension code never reaches the
 *   inspector directly.
 *
 * Hosts own invocation: every `onSelect` callback should run
 * `invokeExtensionContribution` first so the server-side assert gates
 * execution even where the client already hid the control.
 */
import * as React from 'react'
import { Puzzle } from 'lucide-react'

import { Button, CommandGroup, CommandItem } from '#/components/ui'
import type { InspectorTab } from '#/components/record'
import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'

export function ExtensionObjectActions({
  actions,
  onSelect,
}: {
  actions: readonly ResolvedExtensionContribution[]
  onSelect: (action: ResolvedExtensionContribution) => void
}) {
  if (actions.length === 0) return null
  return (
    <>
      {actions.map((action) => (
        <Button
          key={action.key}
          type="button"
          size="sm"
          variant="ghost"
          title={`${action.title} (from ${action.extensionKey})`}
          onClick={() => onSelect(action)}
        >
          <Puzzle className="size-3.5" aria-hidden />
          {action.title}
        </Button>
      ))}
    </>
  )
}

export function ExtensionCommandGroup({
  commands,
  onSelect,
}: {
  commands: readonly ResolvedExtensionContribution[]
  onSelect: (command: ResolvedExtensionContribution) => void
}) {
  if (commands.length === 0) return null
  return (
    <CommandGroup heading="Extensions">
      {commands.map((command) => (
        <CommandItem
          key={command.key}
          value={`${command.title} ${command.extensionKey}`}
          onSelect={() => onSelect(command)}
        >
          <Puzzle className="size-4" aria-hidden />
          {command.title}
          <span className="ml-auto text-xs text-muted-foreground">
            {command.extensionKey}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

/**
 * Map resolved panels onto inspector tabs. `renderContent` is host-owned:
 * the host decides which installed extension keys it can actually render
 * (today only the sample) and returns null for anything else, so unknown
 * extension code never mounts.
 */
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
