import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { Dialog, DialogContent } from '#/components/v3/ui/dialog'
import { Kbd } from '#/components/v3/ui/kbd'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { Highlight } from './highlight'
import { executeSearch } from '#/lib/search'
import type { SearchResult, SearchResultType } from '#/lib/search'
import { notebookDataClient } from '#/lib/notebook-data'
import { cn } from '#/lib/utils'

/**
 * UI port (roadmap-4/ui-app3): the ⌘K search palette. Mounted once in the
 * shell; opens on ⌘K / Ctrl+K and from the top-bar search box. Results come
 * from the real `search` RPC (records, cell values, comments and file
 * contents) through the same-origin data boundary. Enter opens the first
 * result; ⌘↵ opens it in a new tab; "See all" goes to /search.
 */
const GROUP_LABELS: Record<SearchResultType, string> = {
  record: 'Records',
  file: 'Files',
  dataset: 'Datasets',
  sheet: 'Sheets',
  template: 'Templates',
}

const GROUP_ICONS: Record<SearchResultType, IconName> = {
  record: 'box',
  file: 'download',
  dataset: 'database',
  sheet: 'table',
  template: 'template',
}

export function SearchPalette({
  open: openProp,
  onOpenChange,
  initialQuery = '',
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialQuery?: string
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const navigate = useNavigate()
  const listId = useId()
  const [q, setQ] = useState(initialQuery)
  const [res, setRes] = useState<SearchResult[] | null>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const setOpen = (o: boolean) => {
    onOpenChange?.(o)
    if (openProp === undefined) setOpenState(o)
    if (!o) {
      setQ(initialQuery)
      setRes(null)
    }
  }

  useEffect(() => {
    if (openProp !== undefined) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpenState((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openProp])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term) {
      setRes(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      void executeSearch(notebookDataClient, { query: term, limit: 8 }).then(
        (rows) => {
          if (live) {
            setRes(rows)
            setActive(0)
          }
        },
      )
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, open])

  const items = res ?? []

  const go = (result: SearchResult | undefined, newTab = false) => {
    if (!result) return
    if (newTab) {
      window.open(result.deepLink, '_blank', 'noopener')
      return
    }
    setOpen(false)
    void navigate({ to: result.deepLink as never })
  }

  const seeAll = () => {
    setOpen(false)
    void navigate({ to: '/search', search: { q: q.trim() } })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!items.length) return
      const n =
        (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) %
        items.length
      setActive(n)
      listRef.current
        ?.querySelector(`[data-index="${n}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items.length) go(items[active], e.metaKey || e.ctrlKey)
      else if (q.trim()) seeAll()
    }
  }

  let lastGroup = ''
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setQ(initialQuery)
          setRes(null)
        }
      }}
    >
      <DialogContent
        className="top-20 w-[min(640px,calc(100vw-32px))] max-md:inset-0 max-md:max-h-dvh max-md:rounded-none max-md:border-0"
        aria-label="Search"
      >
        <DialogPrimitive.Title className="sr-only">
          Search Sheetbase
        </DialogPrimitive.Title>
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border-subtle px-3.5 max-md:h-14">
          <Icon name="search" size={16} className="text-fg-muted" />
          <label className="flex-1">
            <span className="sr-only">Search</span>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search experiments, samples, datasets"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-activedescendant={
                items.length ? `${listId}-${active}` : undefined
              }
              aria-autocomplete="list"
              className="w-full border-0 bg-transparent font-sans text-[15px] text-fg outline-none placeholder:text-fg-faint"
            />
          </label>
          <DialogPrimitive.Close className="inline-flex h-9 cursor-pointer items-center rounded-md border-0 bg-transparent px-2 text-body text-link md:hidden">
            Cancel
          </DialogPrimitive.Close>
        </div>
        {res && res.length === 0 ? (
          <div role="status" className="flex flex-col gap-2.5 px-5 py-7">
            <div className="font-semibold">No matches for “{q.trim()}”</div>
            <div className="text-body leading-[19px] text-fg-muted">
              Nothing in names, IDs, cell values, comments or files you can
              access.
            </div>
          </div>
        ) : (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Results"
            className="max-h-[440px] overflow-auto pb-2 pt-1 max-md:max-h-none max-md:min-h-0 max-md:flex-1"
          >
            {!q.trim() ? (
              <div className="px-3.5 py-6 text-body text-fg-muted">
                Type an ID like <span className="mono">EXP-0001</span>, a name,
                or a value like <span className="mono">C-150</span>.
              </div>
            ) : null}
            {items.map((item, n) => {
              const group = GROUP_LABELS[item.resultType]
              const header = group !== lastGroup ? group : null
              lastGroup = group
              return (
                <div key={`${item.resultType}-${item.recordId}`}>
                  {header ? (
                    <div
                      role="presentation"
                      className="flex justify-between px-3.5 pb-1 pt-2 text-[11px] font-medium text-fg-muted"
                    >
                      <span>{header}</span>
                    </div>
                  ) : null}
                  <div
                    id={`${listId}-${n}`}
                    data-index={n}
                    role="option"
                    aria-selected={n === active}
                    onMouseMove={() => setActive(n)}
                    onClick={() => go(item)}
                    className={cn(
                      'mx-1 grid cursor-pointer grid-cols-[20px_1fr_auto] items-start gap-2.5 rounded-md px-2.5 py-1.5 text-body max-md:min-h-12 max-md:py-2',
                      n === active && 'bg-selection',
                    )}
                  >
                    <span className="pt-px text-fg-muted">
                      <Icon name={GROUP_ICONS[item.resultType]} size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="mono mr-1.5 text-fg-muted">
                        {item.identifier}
                      </span>
                      <Highlight text={item.title} q={q.trim()} />
                      <span className="block truncate text-label text-fg-muted">
                        {item.matchedContext}
                      </span>
                    </span>
                    {n === active ? <Kbd>↵</Kbd> : <span />}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-3.5 border-t border-border-subtle bg-surface-muted px-3.5 py-2 text-label text-fg-muted max-md:min-h-12 max-md:pb-[max(8px,env(safe-area-inset-bottom))]">
          <span className="max-md:hidden">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span className="max-md:hidden">
            <Kbd>↵</Kbd> open
          </span>
          <span className="max-md:hidden">
            <Kbd>⌘</Kbd> <Kbd>↵</Kbd> open in new tab
          </span>
          <span className="max-md:hidden">
            <Kbd>Esc</Kbd> close
          </span>
          {res && res.length > 0 ? (
            <button
              type="button"
              onClick={seeAll}
              className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              See all results
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
