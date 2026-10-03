import type { ReactNode } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { useShortcuts } from './shortcut-provider'
import { formatShortcut, currentPlatform } from '#/lib/shortcuts'
import type { ShortcutDefinition, ShortcutScope } from '#/lib/shortcuts'

const SCOPE_LABEL: Record<ShortcutScope, string> = {
  global: 'Anywhere',
  list: 'Lists',
  notebook: 'Notebook and sheets',
  review: 'Review',
}

/**
 * The keyboard-shortcuts dialog (SHELL-03), generated from the registry so it
 * can never drift from the shortcuts that actually fire.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
  definitions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  definitions: ShortcutDefinition[]
}): ReactNode {
  const platform = currentPlatform()
  const scopes = ['global', 'list', 'notebook', 'review'] as const
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are suppressed while you are typing in a field.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {scopes.map((scope) => {
            const items = definitions.filter((d) => d.scope === scope)
            if (items.length === 0) return null
            return (
              <section key={scope}>
                <p className="text-label text-muted-foreground">
                  {SCOPE_LABEL[scope]}
                </p>
                <ul className="mt-1 divide-y divide-border-subtle">
                  {items.map((definition) => (
                    <li
                      key={definition.id}
                      className="flex items-center justify-between py-1.5 text-body"
                    >
                      <span>{definition.description}</span>
                      <span className="flex gap-1">
                        {definition.keys.map((binding) => (
                          <kbd
                            key={binding}
                            className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
                          >
                            {formatShortcut(binding, platform)}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The shell's `?` dialog. It reads the provider's live registry rather than a
 * fixed list, so scoped shortcuts registered by whichever screen is mounted
 * appear in the dialog too.
 */
export function RegistryShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): ReactNode {
  const { registry } = useShortcuts()
  return (
    <ShortcutsDialog
      open={open}
      onOpenChange={onOpenChange}
      definitions={registry.definitions}
    />
  )
}
