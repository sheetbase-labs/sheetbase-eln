import { useId } from 'react'
import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
} from '#/components/v3/ui/dialog'
import { Button } from '#/components/v3/ui/button'
import { Icon } from '#/components/v3/icons'
import { Kbd } from '#/components/v3/ui/kbd'
import { cn } from '#/lib/utils'
import { useShortcuts } from './shortcut-provider'
import {
  formatShortcut,
  currentPlatform,
  parseBinding,
  sequenceSteps,
} from '#/lib/shortcuts'
import type {
  Platform,
  ShortcutDefinition,
  ShortcutScope,
} from '#/lib/shortcuts'

const SCOPE_LABEL: Record<ShortcutScope, string> = {
  global: 'Anywhere',
  list: 'Lists',
  notebook: 'Notebook and sheets',
  review: 'Review',
}

/** Shared binding presentation for the registry dialog and help pages. */
export function ShortcutKeys({
  bindings,
  platform,
}: {
  bindings: string[]
  platform: Platform
}) {
  return (
    <span className="whitespace-nowrap">
      {bindings.map((binding, bindingIndex) => (
        <span key={binding}>
          {bindingIndex > 0 ? ' ' : null}
          {sequenceSteps(binding).map((step, stepIndex) => {
            const parsed = parseBinding(step, platform)
            const keys = [
              ...(parsed.meta ? ['⌘'] : []),
              ...(parsed.ctrl ? ['Ctrl'] : []),
              ...(parsed.alt ? [platform === 'mac' ? '⌥' : 'Alt'] : []),
              ...(parsed.shift ? [platform === 'mac' ? '⇧' : 'Shift'] : []),
              formatShortcut(parsed.key, platform),
            ]
            return (
              <span key={step}>
                {stepIndex > 0 ? ' then ' : null}
                {keys.map((key, index) => (
                  <span key={key}>
                    {index > 0 ? ' ' : null}
                    <Kbd>{key}</Kbd>
                  </span>
                ))}
              </span>
            )
          })}
        </span>
      ))}
    </span>
  )
}

/** Catalogue and live route registrations share the same definitions. */
export function ShortcutGroups({
  definitions,
  platform,
  headingLevel = 2,
}: {
  definitions: ShortcutDefinition[]
  platform: Platform
  headingLevel?: 2 | 3
}) {
  const id = useId()
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const scopes = ['global', 'list', 'notebook', 'review'] as const
  const groups = scopes
    .map((scope) => ({
      scope,
      items: definitions.filter((d) => d.scope === scope),
    }))
    .filter((group) => group.items.length > 0)
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-x-10 gap-y-6',
        groups.length > 1 && 'md:grid-cols-2',
      )}
    >
      {groups.map(({ scope, items }) => (
        <section
          key={scope}
          aria-labelledby={`${id}-${scope}`}
          className="flex flex-col gap-1.5"
        >
          <Heading
            id={`${id}-${scope}`}
            className="m-0 mb-1 text-[12px] leading-[normal] font-semibold"
          >
            {SCOPE_LABEL[scope]}
          </Heading>
          <dl className="m-0 flex flex-col gap-1.5">
            {items.map((definition) => (
              <div
                key={definition.id}
                className="flex justify-between gap-3 py-[3px] text-[13px] leading-[normal]"
              >
                <dt>{definition.description}</dt>
                <dd className="m-0">
                  <ShortcutKeys
                    bindings={definition.keys}
                    platform={platform}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[10vh] w-[min(840px,calc(100vw-32px))]">
        <div className="flex items-center border-b border-border-subtle px-5 pb-3 pt-4">
          <DialogPrimitive.Title className="flex-1 font-display text-[16px] leading-[normal] font-semibold">
            Keyboard shortcuts
          </DialogPrimitive.Title>
          <DialogClose render={<Button size="icon" aria-label="Close" />}>
            <Icon name="x" size={14} />
          </DialogClose>
          <DialogPrimitive.Description className="sr-only">
            All keyboard shortcuts, grouped by where they apply. Actions require
            an applicable selection and permission. Shortcuts are suppressed
            while typing except cancelling or saving a cell edit.
          </DialogPrimitive.Description>
        </div>
        <DialogBody>
          <ShortcutGroups
            definitions={definitions.filter(
              (definition) => !definition.additional,
            )}
            platform={platform}
            headingLevel={3}
          />
        </DialogBody>
        <DialogFooter className="items-center justify-between">
          <span className="text-[12px] leading-[normal] text-fg-muted">
            On Windows, use Ctrl for ⌘ and Alt for ⌥.{' '}
            <a
              className="text-link underline"
              href="/help/shortcuts#focus-order"
            >
              Focus order
            </a>
          </span>
          <DialogClose render={<Button />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The shell's `?` dialog lists the complete registry. Only mounted route
 * handlers execute; catalogue visibility does not confer permissions.
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
