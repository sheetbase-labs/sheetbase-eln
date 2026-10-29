import { t } from '#/copy'
import { useState } from 'react'

import { Button } from '#/components/v3/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/v3/ui/command'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'
import {
  BLOCK_PICKER_GROUPS,
  BLOCK_PICKER_OPTIONS,
} from '#/lib/blocks/registry'

/**
 * UI port (roadmap-4/ui-app3): the "+ Add block" menu, as a command palette
 * (the design's AddBlockMenu). Also opens from "/" via the slash menu. The
 * menu is presentational; the parent owns the insert.
 *
 * EXP-04.3: it carries the design's "Insert block" name and the shared block
 * catalogue, so the `+` control and `/` present the same menu.
 */
export function AddBlockMenu({
  onAdd,
  after,
  open,
  onOpenChange,
}: {
  onAdd: (type: string) => void
  after?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('notebook.addBlockMenu.title')}
    >
      <Command label={t('notebook.addBlockMenu.title')}>
        <CommandInput placeholder={t('notebook.addBlockMenu.placeholder')} />
        <CommandList
          label={t('notebook.addBlockMenu.title')}
          className="max-h-[480px] max-md:max-h-none"
        >
          {BLOCK_PICKER_GROUPS.map((group) => {
            const items = BLOCK_PICKER_OPTIONS.filter(
              (opt) => opt.group === group.id,
            )
            if (items.length === 0) return null
            return (
              <CommandGroup key={group.id} heading={group.label}>
                {items.map((opt) => (
                  <CommandItem
                    key={opt.type}
                    value={opt.label}
                    keywords={[opt.description, opt.type, group.label]}
                    onSelect={() => {
                      onAdd(opt.type)
                      onOpenChange(false)
                    }}
                    className="items-start"
                  >
                    <span className="mt-px inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
                      <Icon name={opt.icon} size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{opt.label}</span>
                      <span className="block text-label text-fg-muted">
                        {opt.description}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          })}
          <CommandEmpty>
            {t('notebook.addBlockMenu.noBlockTypeMatches')}
          </CommandEmpty>
        </CommandList>
        <CommandFooter>
          {after ? (
            <span className="ml-auto truncate max-md:ml-0">
              {t('notebook.addBlockMenu.addsAfterAfter', { after })}
            </span>
          ) : null}
        </CommandFooter>
      </Command>
    </CommandDialog>
  )
}

/**
 * A trigger button that opens the add-block palette. `variant="icon"` is the
 * small inline control between blocks; the default is the labelled button.
 */
export function AddBlockControl({
  onInsert,
  after,
  label,
  variant = 'button',
  disabled,
  triggerId,
  className,
}: {
  onInsert: (type: string) => void
  after?: string
  label: string
  variant?: 'button' | 'icon'
  disabled?: boolean
  triggerId?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {variant === 'icon' ? (
        <Button
          id={triggerId}
          type="button"
          variant="secondary"
          size="icon"
          disabled={disabled}
          aria-label={label}
          className={cn('size-6 rounded-full', className)}
          onClick={() => setOpen(true)}
        >
          <Icon name="plus" size={12} />
        </Button>
      ) : (
        <Button
          id={triggerId}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          icon="plus"
          className={cn('justify-start', className)}
          onClick={() => setOpen(true)}
        >
          {label}
        </Button>
      )}
      <AddBlockMenu
        open={open}
        onOpenChange={setOpen}
        after={after}
        onAdd={onInsert}
      />
    </>
  )
}
