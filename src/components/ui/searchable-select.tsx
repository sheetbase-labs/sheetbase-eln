import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { Button } from '#/components/v3/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { cn } from '#/lib/utils'

const VISIBLE_LIMIT = 80

export function SearchableSelect<T>({
  items,
  value,
  onChange,
  getId,
  getLabel,
  getDescription,
  placeholder = 'Search…',
  emptyLabel = 'Nothing matches that search.',
  triggerLabel,
  disabled,
  id,
}: {
  items: T[]
  value: string
  onChange: (id: string) => void
  getId: (item: T) => string
  getLabel: (item: T) => string
  getDescription?: (item: T) => string | null
  placeholder?: string
  emptyLabel?: string
  triggerLabel?: string
  disabled?: boolean
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = items.find((item) => getId(item) === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = needle
      ? items.filter((item) => {
          const hay = [
            getLabel(item),
            getDescription?.(item) ?? '',
            getId(item),
          ]
            .join(' ')
            .toLowerCase()
          return hay.includes(needle)
        })
      : items
    return {
      shown: matched.slice(0, VISIBLE_LIMIT),
      total: matched.length,
    }
  }, [getDescription, getId, getLabel, items, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="secondary"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? getLabel(selected) : (triggerLabel ?? placeholder)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {filtered.shown.map((item) => {
                const itemId = getId(item)
                const description = getDescription?.(item)
                return (
                  <CommandItem
                    key={itemId}
                    value={itemId}
                    onSelect={() => {
                      onChange(itemId)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        'size-4 shrink-0',
                        itemId === value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{getLabel(item)}</span>
                      {description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {description}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
          {filtered.total > VISIBLE_LIMIT ? (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing {VISIBLE_LIMIT} of {filtered.total}. Type to narrow the
              list.
            </p>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
