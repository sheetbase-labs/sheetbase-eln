import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '#/lib/use-platform'
import { formatShortcut } from '#/lib/shortcuts'
import { useNavigate } from '@tanstack/react-router'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { Button } from '#/components/v3/ui/button'
import { Chip } from '#/components/v3/ui/chip'
import {
  Command,
  CommandDialog,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '#/components/v3/ui/command'
import { Kbd } from '#/components/v3/ui/kbd'
import { Select } from '#/components/v3/ui/select'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { useProjectNameMap } from '#/components/v3/experiments/experiments-data'
import { Highlight } from './highlight'
import { goToCommands, matchCommands, newCommands } from './palette-commands'
import type { PaletteCommand } from './palette-commands'
import { searchResultContext, searchResultLabel } from './result-text'
import {
  contextualSearchActions,
  filterBySearchScope,
  executeSearch,
  groupSearchResults,
  rankByTier,
  searchActionHref,
  searchDidYouMean,
  searchResultGroup,
  searchResultNewTabUrl,
  SEARCH_SCOPE_ALL,
} from '#/lib/search'
import type {
  DidYouMeanSuggestion,
  SearchContextAction,
  SearchResult,
  SearchResultGroup,
} from '#/lib/search'
import { notebookDataClient } from '#/lib/notebook-data'
import { requestOpenBeside } from '#/components/workspace/workspace-navigation'

/**
 * UI port (roadmap-4/ui-app3): the ⌘K search palette. Mounted once in the
 * shell; opens on ⌘K / Ctrl+K and from the top-bar search box. SRCH-02 adds
 * the design's scope selector, grouped and truncated results, contextual
 * actions, and keyboard parity: ↑↓ move, ↵ open, ⌘↵ open in a new tab, Esc
 * closes and returns focus. The shell owns the Cmd-K shortcut, so this
 * component installs no global key listener.
 *
 * R5-SHELL-04 adds the archived scope (pushed to the search boundary as
 * `p_include_archived`, never filtered here) and a "Did you mean {id}?"
 * correction from `api.search_did_you_mean` when a query finds nothing.
 *
 * The list is the forward kit's Command (`src/components/v3/ui/command.tsx`) —
 * combobox wiring, active option, group headings and the footer chrome are
 * its, not this screen's; what stays here is the search itself and its own
 * states (error, scope miss, correction).
 */
const MAX_PER_GROUP = 3
const FETCH_LIMIT = 24

const GROUP_ICONS: Record<SearchResultGroup, IconName> = {
  Samples: 'tube',
  'Sheet and dataset rows': 'table',
  'Notebook text and comments': 'comment',
  Records: 'box',
  Projects: 'folder',
  Pipelines: 'pipeline',
  Analyses: 'chart',
  Files: 'download',
  Templates: 'template',
}

/** Human type of a record kind, for the identifier suggestion line. */
const SUGGESTION_KIND_LABELS: Record<string, string> = {
  sample: 'Sample',
  material: 'Material',
  experiment: 'Experiment',
  protocol_template: 'Protocol',
  report: 'Report',
  study: 'Study',
  file: 'File',
}

type PaletteEntry =
  | { type: 'result'; result: SearchResult }
  | { type: 'action'; action: SearchContextAction }

/** A row's key, and the value the kit's CommandItem tracks it by. */
const resultKey = (result: SearchResult) =>
  `${result.resultType}-${result.recordId}`

/** Every option shares the design's three-column row: icon, text, ↵ hint. */
const optionRow =
  'group grid grid-cols-[20px_1fr_auto] items-start gap-2.5 rounded-md px-2.5 py-1.5 text-body max-md:min-h-12 max-md:py-2'
/** The ↵ hint only occupies a column on the active row, as the design draws it. */
const optionHint = 'hidden group-aria-selected:inline-flex'

/** Typed queries show only the best few commands; an empty one lists them all. */
const MAX_TYPED_COMMANDS = 4

export function SearchPalette({
  open: openProp,
  onOpenChange,
  initialQuery = '',
  role,
  pathname,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialQuery?: string
  /** The viewer's workspace role: Go to lists only pages they can open. */
  role?: string | null
  /** The page behind the palette: New hands its project, sample or dataset on. */
  pathname?: string
}) {
  const platform = usePlatform()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const navigate = useNavigate()
  const [q, setQ] = useState(initialQuery)
  const [scope, setScope] = useState<string>(SEARCH_SCOPE_ALL)
  // Archived scope: pushed to the search boundary, never a browser-side
  // filter. Off by default, matching the results page.
  const [archived, setArchived] = useState(false)
  const [res, setRes] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [searching, setSearching] = useState(false)
  const [suggestion, setSuggestion] = useState<DidYouMeanSuggestion | null>(
    null,
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // A response must not write into the palette once a newer search, or the
  // close that follows it, has superseded it.
  const searchGeneration = useRef(0)
  const projects = useProjectNameMap()

  const reset = () => {
    searchGeneration.current += 1
    setQ(initialQuery)
    setScope(SEARCH_SCOPE_ALL)
    setArchived(false)
    setRes(null)
    setError(null)
    setSearching(false)
    setSuggestion(null)
  }

  const setOpen = (o: boolean) => {
    onOpenChange?.(o)
    if (openProp === undefined) setOpenState(o)
    if (!o) reset()
  }

  // The palette's search: the failure is kept so the palette can say what
  // happened and offer the retry, rather than leaving an empty listbox.
  const runSearch = useCallback(
    (term: string, nextScope: string, nextArchived: boolean) => {
      const generation = (searchGeneration.current += 1)
      setSearching(true)
      setError(null)
      void executeSearch(notebookDataClient, {
        query: term,
        limit: FETCH_LIMIT,
        projectId: nextScope === SEARCH_SCOPE_ALL ? undefined : nextScope,
        includeArchived: nextArchived,
      })
        .then((rows) => {
          if (generation !== searchGeneration.current) return
          setRes(rows)
          setSearching(false)
        })
        .catch((cause: unknown) => {
          if (generation !== searchGeneration.current) return
          setRes(null)
          setSearching(false)
          setError(cause)
        })
    },
    [],
  )

  // Esc is owned by the Dialog primitive, which calls onOpenChange(false).
  // Capture the previously focused element before moving focus into the
  // search input, then restore it when the palette closes. The input has no
  // `autoFocus` so this capture still sees the pre-open element.
  useEffect(() => {
    if (open) {
      const el = document.activeElement
      restoreFocusRef.current =
        el instanceof HTMLElement && el !== inputRef.current ? el : null
      inputRef.current?.focus()
    } else {
      restoreFocusRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term) {
      setRes(null)
      setError(null)
      setSearching(false)
      return
    }
    setSuggestion(null)
    setSearching(true)
    const t = setTimeout(() => runSearch(term, scope, archived), 120)
    return () => {
      searchGeneration.current += 1
      clearTimeout(t)
    }
  }, [q, open, scope, archived, runSearch])

  // When a query genuinely finds nothing the palette offers a corrected
  // identifier, resolved at the canonical search boundary
  // (`api.search_did_you_mean`), so a suggestion never names an object the
  // person cannot see. Accepting it navigates through `/records/$recordId`,
  // where the existing identifier resolver turns the display id into its row.
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (!term || res === null || res.length > 0) {
      setSuggestion(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      void searchDidYouMean(notebookDataClient, term, archived).then((rows) => {
        if (live) setSuggestion(rows[0] ?? null)
      })
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, open, res, archived])

  const items = res ?? []
  // The chosen project's name, so the empty state can name the scope rather
  // than the id it was chosen by.
  const scopeLabel =
    scope === SEARCH_SCOPE_ALL ? null : (projects.data?.get(scope) ?? null)
  const scoped = useMemo(
    () =>
      filterBySearchScope(
        items,
        scope === SEARCH_SCOPE_ALL ? undefined : scope,
      ),
    [items, scope],
  )
  const buckets = useMemo(() => {
    // The palette is a jump list, so its rows follow relevance, not the results
    // page's fixed section order: grouping a weak sheet or dataset hit into the
    // second section would put it above the record that matched the query best.
    // The list is ranked by the canonical tiers (exact identifier, then title,
    // then structured, then text) and each section sits where its best row
    // does, with the canonical order left as the tie-break.
    const ranked = rankByTier(scoped, q.trim())
    const grouped = groupSearchResults(ranked, MAX_PER_GROUP)
    const sectionAt = new Map<SearchResultGroup, number>()
    ranked.forEach((result, index) => {
      const group = searchResultGroup(result)
      if (!sectionAt.has(group)) sectionAt.set(group, index)
    })
    return [...grouped].sort(
      (a, b) => (sectionAt.get(a.group) ?? 0) - (sectionAt.get(b.group) ?? 0),
    )
  }, [scoped, q])
  const actions = useMemo(() => contextualSearchActions(scoped), [scoped])
  const commandMatch = useMemo(() => {
    const all = [...goToCommands(role), ...newCommands(pathname)]
    const match = matchCommands(all, q)
    // A plain word searches first: its commands join once the results are in,
    // so the first row the keyboard lands on is a result, not a page link.
    const settled = res !== null && !searching
    const limited =
      q.trim() && !match.leads
        ? settled
          ? match.commands.slice(0, MAX_TYPED_COMMANDS)
          : []
        : match.commands
    return {
      leads: match.leads,
      goTo: limited.filter((c) => c.group === 'Go to'),
      create: limited.filter((c) => c.group === 'New'),
    }
  }, [q, role, pathname, res, searching])
  const commandCount = commandMatch.goTo.length + commandMatch.create.length
  const entryCount =
    buckets.reduce((n, bucket) => n + bucket.results.length, 0) +
    actions.length +
    commandCount

  const runCommand = (command: PaletteCommand, newTab = false) => {
    if (newTab) {
      window.open(
        searchResultNewTabUrl(
          searchActionHref({
            id: command.id,
            label: command.label,
            to: command.to,
            search: command.search,
          }),
          window.location.origin,
        ),
        '_blank',
        'noopener,noreferrer',
      )
      return
    }
    setOpen(false)
    void navigate({
      to: command.to as never,
      search: command.search as never,
    })
  }
  const commandGroups = (heading: 'Go to' | 'New', list: PaletteCommand[]) =>
    list.length ? (
      <CommandGroup key={heading} heading={heading}>
        {list.map((command) => (
          <CommandItem
            key={command.id}
            value={command.id}
            onSelect={(_value, newTab) => runCommand(command, newTab)}
            className={optionRow}
          >
            <span className="pt-px text-fg-muted">
              <Icon name={command.icon} size={14} />
            </span>
            <span className="min-w-0">{command.label}</span>
            <Kbd className={optionHint}>↵</Kbd>
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null

  const go = (result: SearchResult, newTab = false, beside = false) => {
    if (beside) {
      setOpen(false)
      requestOpenBeside(result.deepLink, result.title)
      return
    }
    if (newTab) {
      window.open(
        searchResultNewTabUrl(result.deepLink, window.location.origin),
        '_blank',
        'noopener,noreferrer',
      )
      return
    }
    setOpen(false)
    void navigate({ to: result.deepLink as never })
  }

  const runAction = (action: SearchContextAction, newTab = false) => {
    if (newTab) {
      window.open(
        searchResultNewTabUrl(searchActionHref(action), window.location.origin),
        '_blank',
        'noopener,noreferrer',
      )
      return
    }
    setOpen(false)
    void navigate({
      to: action.to as never,
      search: action.search as never,
    })
  }

  const activate = (
    entry: PaletteEntry | undefined,
    newTab = false,
    beside = false,
  ) => {
    if (!entry) return
    if (entry.type === 'result') go(entry.result, newTab, beside)
    else runAction(entry.action, newTab)
  }

  const seeAll = () => {
    setOpen(false)
    void navigate({ to: '/search', search: { q: q.trim() } })
  }

  // Accepting the correction navigates by display identifier; the record route
  // resolves it through the canonical identifier resolver (`/records/$recordId`
  // → resolveIdentifierParam), so a mistyped id lands on the real object or on
  // nothing at all — never on a different one.
  const acceptSuggestion = (s: DidYouMeanSuggestion) => {
    setOpen(false)
    void navigate({
      to: '/records/$recordId',
      params: { recordId: s.identifier },
    })
  }

  // The list's own keyboard handling is the kit's (↑ ↓, Home/End, ↵, ⌘/Ctrl+↵
  // with `newTab`). The one case left here is ↵ with nothing to open: the
  // palette has no row to activate, so it goes to the results page.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !entryCount && q.trim()) {
      e.preventDefault()
      seeAll()
    }
  }

  const totalCount = items[0]?.totalCount
  const seeAllLabel =
    scope === SEARCH_SCOPE_ALL && totalCount
      ? `See all ${totalCount} results`
      : 'See all results'
  // QA3-palette-2 — the listbox only replaces the error and no-match states
  // when it is actually rendered; `aria-controls` must not point at an id the
  // document does not contain in those states (CommandInput reads whether a
  // CommandList is mounted and drops both attributes when none is).
  const showList =
    !error && !(res !== null && q.trim() && entryCount === 0 && !searching)

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search Sheetbase"
      className="w-[min(640px,calc(100vw-32px))] max-md:inset-0 max-md:max-h-dvh max-md:rounded-none max-md:border-0"
    >
      <Command
        label="Search"
        query={q}
        onQueryChange={setQ}
        shouldFilter={false}
        loading={searching}
      >
        <CommandInput
          ref={inputRef}
          // The design's palette header is 48px (SearchPalette canvas), the
          // kit's command row is 44px.
          rowClassName="h-12"
          placeholder="Search experiments, samples, datasets"
          aria-label="Search"
          autoFocus={false}
          onKeyDown={onKeyDown}
          trailing={
            <>
              <label className="shrink-0">
                <span className="sr-only">Scope</span>
                <Select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  aria-label="Search scope"
                  className="w-[150px] max-md:w-[128px]"
                >
                  <option value={SEARCH_SCOPE_ALL}>In: all projects</option>
                  {[...(projects.data ?? new Map()).entries()].map(
                    ([id, name]) => (
                      <option key={id} value={id}>
                        In: {name}
                      </option>
                    ),
                  )}
                </Select>
              </label>
              <Chip
                variant="toggle"
                pressed={archived}
                onClick={() => setArchived((a) => !a)}
                icon="archive"
                aria-label="Include archived"
              >
                {/* QA3-palette-1 — the scope stays available at every width: the
                    label becomes screen-reader only rather than being removed
                    with the control (the label is also the accessible name). */}
                <span className="max-md:sr-only">Include archived</span>
              </Chip>
              <DialogPrimitive.Close className="inline-flex h-9 cursor-pointer items-center rounded-md border-0 bg-transparent px-2 text-body text-link md:hidden">
                Cancel
              </DialogPrimitive.Close>
            </>
          }
        />
        {error ? (
          <div role="alert" className="flex flex-col gap-2.5 px-5 py-7">
            <div className="font-semibold">Search could not run</div>
            <div className="text-body leading-[19px] text-fg-muted">
              The search service did not answer, so nothing was searched.
            </div>
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => runSearch(q.trim(), scope, archived)}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : !showList ? (
          <div role="status" className="flex flex-col gap-2.5 px-5 py-7">
            {items.length > 0 ? (
              <>
                <div className="font-semibold">
                  No matches in {scopeLabel ?? 'this project'}
                </div>
                <div className="text-body leading-[19px] text-fg-muted">
                  {items.length}{' '}
                  {items.length === 1 ? 'match is' : 'matches are'} for “
                  {q.trim()}” outside {scopeLabel ?? 'it'}.
                </div>
                <div className="text-body">
                  <button
                    type="button"
                    onClick={() => setScope(SEARCH_SCOPE_ALL)}
                    className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
                  >
                    Search all projects
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="font-semibold">No matches for “{q.trim()}”</div>
                <div className="text-body leading-[19px] text-fg-muted">
                  Nothing in names, IDs, cell values, comments or files you can
                  access.
                </div>
                {suggestion ? (
                  <div className="text-body">
                    Did you mean{' '}
                    <button
                      type="button"
                      onClick={() => acceptSuggestion(suggestion)}
                      className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-medium text-link hover:underline"
                    >
                      {suggestion.identifier}
                    </button>
                    ?{' '}
                    <span className="text-fg-muted">
                      {suggestion.title} ·{' '}
                      {SUGGESTION_KIND_LABELS[suggestion.kind] ??
                        suggestion.kind}
                    </span>
                  </div>
                ) : null}
                <div className="text-label text-fg-muted">
                  {archived ? (
                    <>
                      Archived work searched too: still no matches for “
                      {q.trim()}”.{' '}
                      <button
                        type="button"
                        onClick={() => setArchived(false)}
                        className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
                      >
                        Search active work only
                      </button>
                    </>
                  ) : (
                    <>
                      Archived work isn’t searched.{' '}
                      <button
                        type="button"
                        onClick={() => setArchived(true)}
                        className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
                      >
                        Include archived
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <CommandList className="max-h-[440px] pb-2 pt-1 max-md:max-h-none">
            {!q.trim() ? (
              <div className="px-3.5 py-3 text-body text-fg-muted">
                Type an ID like <span className="mono">EXP-0001</span>, a name,
                or a value like <span className="mono">C-150</span>.
              </div>
            ) : null}
            {commandMatch.leads ? (
              <>
                {commandGroups('New', commandMatch.create)}
                {commandGroups('Go to', commandMatch.goTo)}
              </>
            ) : null}
            {searching ? (
              <div
                role="status"
                className="px-3.5 py-3 text-body text-fg-muted"
              >
                Searching…
              </div>
            ) : null}
            {buckets.map((bucket) => (
              <CommandGroup
                key={bucket.group}
                heading={bucket.group}
                action={<span className="num">{bucket.total}</span>}
              >
                {bucket.results.map((result) => {
                  const label = searchResultLabel(result)
                  return (
                    <CommandItem
                      key={resultKey(result)}
                      value={resultKey(result)}
                      onSelect={(_value, newTab, beside) =>
                        activate({ type: 'result', result }, newTab, beside)
                      }
                      className={optionRow}
                    >
                      <span className="pt-px text-fg-muted">
                        <Icon name={GROUP_ICONS[bucket.group]} size={14} />
                      </span>
                      <span className="min-w-0">
                        {label ? (
                          <span className="mono mr-1.5 text-fg-muted">
                            {label}
                          </span>
                        ) : null}
                        {result.archived ? (
                          <span className="mr-1.5 rounded-sm border border-border px-1 align-middle text-label text-fg-muted">
                            Archived
                          </span>
                        ) : null}
                        <Highlight text={result.title} q={q.trim()} />
                        <span className="block truncate text-label text-fg-muted">
                          {searchResultContext(
                            result,
                            result.matchedContext,
                          ).map((segment, i) =>
                            segment.highlighted ? (
                              <mark
                                key={i}
                                className="rounded-[2px] bg-highlight px-px text-fg"
                              >
                                {segment.text}
                              </mark>
                            ) : (
                              <span key={i}>{segment.text}</span>
                            ),
                          )}
                        </span>
                      </span>
                      <Kbd className={optionHint}>↵</Kbd>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
            {commandMatch.leads ? null : (
              <>
                {commandGroups('Go to', commandMatch.goTo)}
                {commandGroups('New', commandMatch.create)}
              </>
            )}
            {actions.length ? (
              <CommandGroup heading="Actions">
                {actions.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={action.id}
                    onSelect={(_value, newTab) => runAction(action, newTab)}
                    className={optionRow}
                  >
                    <span className="pt-px text-fg-muted">
                      <Icon name="plus" size={14} />
                    </span>
                    <span className="min-w-0">{action.label}</span>
                    <Kbd className={optionHint}>↵</Kbd>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        )}
        <CommandFooter hints={false}>
          <span className="max-md:hidden">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span className="max-md:hidden">
            <Kbd>↵</Kbd> open
          </span>
          <span className="max-md:hidden">
            <Kbd>{formatShortcut('alt+enter', platform)}</Kbd> open beside
          </span>
          <span className="max-md:hidden">
            <Kbd>{formatShortcut('mod+enter', platform)}</Kbd> open in new tab
          </span>
          <span className="max-md:hidden">
            <Kbd>Esc</Kbd> close
          </span>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={seeAll}
              className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-link hover:underline"
            >
              {seeAllLabel}
            </button>
          ) : null}
        </CommandFooter>
      </Command>
    </CommandDialog>
  )
}
