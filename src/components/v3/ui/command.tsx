import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Dialog, DialogContent } from './dialog'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Kbd } from './kbd'
import { Skeleton } from './skeleton'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

// Command (cmdk-style, no extra package): a searchable list you drive from the keyboard.
//   <Command label="Add block">
//     <CommandInput placeholder="Search blocks" />
//     <CommandList>
//       <CommandEmpty>No blocks match.</CommandEmpty>
//       <CommandGroup heading="Write"><CommandItem value="text" onSelect={…}>Text</CommandItem></CommandGroup>
//     </CommandList>
//   </Command>
// Items filter themselves against the query (value + keywords) unless `shouldFilter={false}` (server search).
// ↑ ↓ move, Home/End jump, ↵ selects, the pointer follows the mouse. Groups with no visible items hide themselves.
// Put it in <CommandDialog> (Base UI Dialog; a bottom sheet on phones) or <CommandPopover> (Base UI Popover).

type Ctx = {
  query: string
  setQuery: (q: string) => void
  active: string | null
  setActive: (v: string) => void
  shouldFilter: boolean
  listId: string
  count: number
  loading: boolean
  setLoading: (l: boolean) => void
}
const CommandContext = createContext<Ctx | null>(null)
const useCommand = () => {
  const c = useContext(CommandContext)
  if (!c) throw new Error('Command parts must be inside <Command>')
  return c
}

export const optionId = (listId: string, value: string) =>
  `${listId}-${value.replace(/[^\w-]/g, '_')}`
const matches = (query: string, words: string[]) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = words.join(' ').toLowerCase()
  return q.split(/\s+/).every((t) => hay.includes(t))
}

export function Command({
  label,
  query: queryProp,
  onQueryChange,
  shouldFilter = true,
  loop = true,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onKeyDown'> & {
  label: string
  query?: string
  onQueryChange?: (q: string) => void
  shouldFilter?: boolean
  loop?: boolean
}) {
  const [queryState, setQueryState] = useState('')
  const query = queryProp ?? queryState
  const setQuery = useCallback(
    (q: string) => {
      onQueryChange?.(q)
      if (queryProp === undefined) setQueryState(q)
    },
    [onQueryChange, queryProp],
  )
  const [active, setActive] = useState<string | null>(null)
  const [count, setCount] = useState(-1)
  const [loading, setLoading] = useState(false)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)

  const items = () => [
    ...(root.current?.querySelectorAll<HTMLElement>(
      '[data-command-item]:not([aria-disabled="true"])',
    ) ?? []),
  ]
  // After every render: keep the active item on a visible, enabled item, and count what is visible (for CommandEmpty).
  useLayoutEffect(() => {
    const els = items()
    const n = root.current?.querySelectorAll('[data-command-item]').length ?? 0
    if (n !== count) setCount(n)
    if (!els.some((e) => e.dataset.value === active)) {
      const first = els[0]?.dataset.value ?? null
      if (first !== active) setActive(first)
    }
  })
  // Start at the top whenever the query changes.
  useLayoutEffect(() => {
    setActive(items()[0]?.dataset.value ?? null)
  }, [query])

  const move = (to: HTMLElement | undefined) => {
    if (!to) return
    setActive(to.dataset.value!)
    to.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = items()
    const i = els.findIndex((x) => x.dataset.value === active)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!els.length) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      const n =
        i < 0
          ? 0
          : loop
            ? (i + d + els.length) % els.length
            : Math.max(0, Math.min(els.length - 1, i + d))
      move(els[n])
    } else if (
      (e.key === 'Home' || e.key === 'End') &&
      (e.target as HTMLElement).tagName !== 'INPUT'
    ) {
      e.preventDefault()
      move(e.key === 'Home' ? els[0] : els[els.length - 1])
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      if (i >= 0) {
        e.preventDefault()
        els[i].click()
      }
    }
  }
  return (
    <CommandContext.Provider
      value={{
        query,
        setQuery,
        active,
        setActive,
        shouldFilter,
        listId,
        count,
        loading,
        setLoading,
      }}
    >
      <div
        ref={root}
        data-slot="command"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn('flex min-h-0 flex-col', className)}
        {...props}
      >
        {children}
      </div>
    </CommandContext.Provider>
  )
}

export function CommandInput({
  className,
  placeholder,
  icon = 'search',
  autoFocus = true,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  icon?: IconName | false
  onValueChange?: (value: string) => void
}) {
  const c = useCommand()
  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border-subtle px-3.5 max-md:h-14">
      {icon ? <Icon name={icon} size={16} className="text-fg-muted" /> : null}
      <input
        value={c.query}
        onChange={(e) => {
          c.setQuery(e.target.value)
          onValueChange?.(e.target.value)
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded
        aria-controls={c.listId}
        aria-autocomplete="list"
        aria-label={placeholder}
        aria-activedescendant={
          c.active ? optionId(c.listId, c.active) : undefined
        }
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent font-sans text-[15px] text-fg outline-none placeholder:text-fg-faint',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export function CommandList({
  className,
  label = 'Results',
  ...props
}: React.ComponentProps<'div'> & { label?: string }) {
  const c = useCommand()
  return (
    <div
      id={c.listId}
      role="listbox"
      aria-label={label}
      aria-busy={c.loading || undefined}
      className={cn('min-h-0 flex-1 overflow-auto py-1', className)}
      {...props}
    />
  )
}

export function CommandGroup({
  heading,
  action,
  className,
  children,
}: {
  heading?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <div
      role="group"
      aria-labelledby={heading ? id : undefined}
      className={cn('[&:not(:has([data-command-item]))]:hidden', className)}
    >
      {heading ? (
        <div
          id={id}
          role="presentation"
          className="flex items-baseline justify-between px-3.5 pb-1 pt-2 text-[11px] font-medium text-fg-muted"
        >
          {heading}
          {action}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function CommandItem({
  value,
  keywords = [],
  disabled,
  onSelect,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  value: string
  keywords?: string[]
  disabled?: boolean
  onSelect?: (value: string) => void
}) {
  const c = useCommand()
  if (c.shouldFilter && !matches(c.query, [value, ...keywords])) return null
  const on = c.active === value
  return (
    <div
      id={optionId(c.listId, value)}
      role="option"
      data-command-item=""
      data-value={value}
      aria-selected={on}
      aria-disabled={disabled || undefined}
      onMouseMove={() => {
        if (!disabled && !on) c.setActive(value)
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (!disabled) onSelect?.(value)
      }}
      className={cn(
        'mx-1 flex min-h-8 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body text-fg max-md:min-h-11 aria-disabled:cursor-default aria-disabled:text-fg-faint aria-selected:bg-selection [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CommandEmpty({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const c = useCommand()
  if (c.count !== 0 || c.loading) return null
  return (
    <div
      role="status"
      className={cn('px-3.5 py-6 text-body text-fg-muted', className)}
    >
      {children}
    </div>
  )
}

/** A loading row while results come from the server. Also marks the list busy. */
export function CommandLoading({
  loading,
  label = 'Searching…',
  rows = 3,
}: {
  loading: boolean
  label?: string
  rows?: number
}) {
  const c = useCommand()
  useLayoutEffect(() => {
    c.setLoading(loading)
  }, [loading])
  if (!loading) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-1 px-1 py-1"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex h-9 items-center gap-2.5 px-2.5"
        >
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3" style={{ width: `${46 - i * 9}%` }} />
        </div>
      ))}
    </div>
  )
}

export function CommandSeparator({ className }: { className?: string }) {
  return (
    <div
      role="separator"
      className={cn('my-1 h-px bg-border-subtle', className)}
    />
  )
}

/** Footer with the keyboard hints (hidden on phones, where there is no keyboard). */
export function CommandFooter({
  className,
  children,
  hints = true,
}: {
  className?: string
  children?: React.ReactNode
  hints?: boolean
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-3.5 border-t border-border-subtle bg-surface-muted px-3.5 py-2 text-label text-fg-muted max-md:min-h-12 max-md:pb-[max(8px,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {hints ? (
        <>
          <span className="max-md:hidden">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span className="max-md:hidden">
            <Kbd>↵</Kbd> choose
          </span>
          <span className="max-md:hidden">
            <Kbd>Esc</Kbd> close
          </span>
        </>
      ) : null}
      {children}
    </div>
  )
}

/** Command in a modal dialog (a bottom sheet on phones). The title is for screen readers. */
export function CommandDialog({
  open,
  onOpenChange,
  title,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'top-20 w-[min(560px,calc(100vw-32px))] max-md:max-h-[85dvh]',
          className,
        )}
      >
        <DialogPrimitive.Title className="sr-only">
          {title}
        </DialogPrimitive.Title>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** Command anchored to a trigger (a combobox-style picker). */
export function CommandPopover({
  trigger,
  open,
  onOpenChange,
  align = 'start',
  className,
  children,
}: {
  trigger: React.ReactElement<Record<string, unknown>>
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: 'start' | 'end' | 'center'
  className?: string
  children: React.ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align={align}
        className={cn(
          'flex max-h-[min(420px,70vh)] w-[min(420px,calc(100vw-32px))] flex-col',
          className,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
