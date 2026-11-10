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
 * `toExtensionPanelTabs`, the third slot, lives in `extension-panel-tabs.ts`
 * so this module exports components only.
 *
 * Hosts own invocation: every `onSelect` callback should run
 * `invokeExtensionContribution` first so the server-side assert gates
 * execution even where the client already hid the control.
 */
import { Icon } from '#/components/icons'

import { Button } from '#/components/ui/button'
import { CommandGroup, CommandItem } from '#/components/ui/command'
import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'
import { t } from '#/copy'

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
          variant="quiet"
          title={t('settings.extensionsExtensionSlots.from', {
            title: action.title,
            extensionKey: action.extensionKey,
          })}
          onClick={() => onSelect(action)}
        >
          <Icon name="puzzle" className="size-3.5" aria-hidden />
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
    <CommandGroup
      heading={t('settings.extensionsExtensionSlots.extensionsHeading')}
    >
      {commands.map((command) => (
        <CommandItem
          key={command.key}
          value={`${command.title} ${command.extensionKey}`}
          onSelect={() => onSelect(command)}
        >
          <Icon name="puzzle" className="size-4" aria-hidden />
          {command.title}
          <span className="ml-auto text-xs text-fg-muted">
            {command.extensionKey}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
