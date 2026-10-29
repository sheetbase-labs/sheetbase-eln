import { t } from '#/copy'
import { useEffect, useMemo, useState } from 'react'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from '#/components/v3/ui/command'
import { Chip } from '#/components/v3/ui/chip'
import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import { Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * Entity picker: the one way to choose a project, experiment, protocol,
 * instrument, person, model record and the like. It replaces the bare
 * `<select>`, which cannot be searched, filtered or scanned once a workspace
 * holds more than a few dozen of anything.
 *
 * `PickerSelect` is the form control: it reads like a select (the chosen
 * record, a chevron) and opens `EntityPickerDialog`, a searchable list with
 * filter chips and status. A caller either hands over `options` (a list it
 * already holds, searched and filtered here) or a `search` function (the
 * server does the searching, so the list can be any size). The two modes look
 * the same.
 */

export interface PickerOption {
  /** The stable value the form stores. */
  id: string
  label: string
  /** Mono identifier shown before the label (EXP-0145, SMP-2249). */
  identifier?: string
  /** Second line: the project, the lead, the location. */
  detail?: string
  status?: { tone: Tone; label: string }
  /** Values the filter chips narrow on, keyed by facet key. */
  facets?: Record<string, string>
  /** Heading the option is listed under. */
  group?: string
  /** Words that also match a search but are not shown. */
  keywords?: string[]
  disabled?: boolean
  /** Shown in place of the status when the option cannot be chosen. */
  disabledReason?: string
}

export interface PickerFacet {
  key: string
  /** Name of the filter, announced to screen readers. */
  label: string
}

export interface PickerSearchResult {
  options: PickerOption[]
  /** The options are the person's recent picks, not matches for a query. */
  recent?: boolean
  /** Matches beyond the ones returned. */
  total?: number
}

/** Beyond this many local matches the list says so and asks for a narrower query. */
const RENDER_CAP = 100
const humanise = (key: string) => {
  const text = key.replace(/[_-]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

type FilterField = {
  key: string
  label: string
  values: [string, number][]
}

/** A value list for one field: tick any number of values. */
function ValueList({
  field,
  selected,
  onToggle,
}: {
  field: FilterField
  selected: string[]
  onToggle: (v: string) => void
}) {
  const [vq, setVq] = useState('')
  const shown = field.values.filter(([v]) => norm(v).includes(norm(vq)))
  return (
    <div className="flex w-[260px] max-w-[calc(100vw-32px)] flex-col">
      {field.values.length > 8 ? (
        <input
          autoFocus
          value={vq}
          onChange={(e) => setVq(e.target.value)}
          placeholder={t('notebook.entityPicker.placeholder', {
            label: field.label.toLowerCase(),
          })}
          aria-label={t('notebook.entityPicker.placeholder', {
            label: field.label.toLowerCase(),
          })}
          className="m-1.5 h-7 rounded-md border border-border bg-surface px-2 text-label outline-none focus-visible:outline-2 focus-visible:outline-focus"
        />
      ) : null}
      <div className="max-h-[260px] overflow-auto p-1">
        {shown.map(([v, n]) => (
          <label
            key={v}
            className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-body hover:bg-surface-hover max-md:min-h-11"
          >
            <Checkbox
              checked={selected.includes(v)}
              onCheckedChange={() => onToggle(v)}
            />
            <span className="min-w-0 flex-1 truncate">{v}</span>
            <span className="num text-label text-fg-muted">{n}</span>
          </label>
        ))}
        {!shown.length ? (
          <p className="m-0 px-2 py-3 text-label text-fg-muted">
            {t('notebook.entityPicker.noMatches')}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** An applied filter: "Stage: Discovery, Clinical" with its values editable. */
function FilterChip({
  field,
  selected,
  onToggle,
  onRemove,
}: {
  field: FilterField
  selected: string[]
  onToggle: (v: string) => void
  onRemove: () => void
}) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-selection-border bg-selection pl-2 pr-0.5 text-label max-md:h-9">
      <Popover>
        <PopoverTrigger
          className="cursor-pointer border-0 bg-transparent p-0 text-label text-fg"
          aria-label={t('notebook.entityPicker.ariaLabel', {
            label: field.label,
          })}
        >
          <span className="text-fg-muted">{field.label}:</span>{' '}
          <span className="font-medium">
            {selected.length > 2
              ? `${selected.slice(0, 2).join(', ')} +${selected.length - 2}`
              : selected.join(', ')}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start">
          <ValueList field={field} selected={selected} onToggle={onToggle} />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={t('notebook.entityPicker.removeFilterLabelAriaLabel', {
          label: field.label,
        })}
        onClick={onRemove}
        className="ml-1 inline-flex size-[18px] cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        <Icon name="x" size={10} />
      </button>
    </span>
  )
}

/** "+ Filter": choose any field the records have, then tick its values. */
function AddFilter({
  fields,
  hasActive,
  onToggle,
}: {
  fields: FilterField[]
  hasActive: boolean
  onToggle: (key: string, v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<FilterField | null>(null)
  if (!fields.length) return null
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setField(null)
      }}
    >
      <PopoverTrigger
        className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border bg-transparent px-2 text-label text-fg-muted hover:bg-surface-hover hover:text-fg max-md:h-9"
        aria-label={t('notebook.entityPicker.addAFilterAriaLabel')}
      >
        <Icon name="plus" size={12} />
        {hasActive
          ? t('common.actions.filter')
          : t('notebook.entityPicker.addFilter')}
      </PopoverTrigger>
      <PopoverContent align="start">
        {field ? (
          <div>
            <button
              type="button"
              onClick={() => setField(null)}
              className="flex w-full cursor-pointer items-center gap-1.5 border-0 border-b border-border-subtle bg-transparent px-2.5 py-2 text-left text-label font-medium text-fg"
            >
              <Icon name="chevronRight" size={12} className="rotate-180" />
              {field.label}
            </button>
            <ValueList
              field={field}
              selected={[]}
              onToggle={(v) => {
                onToggle(field.key, v)
                setOpen(false)
                setField(null)
              }}
            />
          </div>
        ) : (
          <div className="flex w-[220px] flex-col p-1">
            {fields.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setField(f)}
                className="flex min-h-8 cursor-pointer items-center justify-between rounded-md border-0 bg-transparent px-2 text-left text-body hover:bg-surface-hover max-md:min-h-11"
              >
                {f.label}
                <Icon name="chevronRight" size={12} />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

const norm = (s: string) => s.toLowerCase()

export function filterPickerOptions(
  options: PickerOption[],
  query: string,
  active: Record<string, string[]>,
): PickerOption[] {
  const terms = norm(query).split(/\s+/).filter(Boolean)
  return options.filter((o) => {
    // A value list is an OR within one field; fields combine with AND.
    for (const [key, values] of Object.entries(active)) {
      const v = o.facets?.[key]
      if (!values.length) continue
      if (!v || !values.includes(v)) return false
    }
    if (!terms.length) return true
    const hay = norm(
      [
        o.identifier,
        o.label,
        o.detail,
        ...(o.keywords ?? []),
        ...Object.values(o.facets ?? {}),
      ]
        .filter(Boolean)
        .join(' '),
    )
    return terms.every((term) => hay.includes(term))
  })
}

/** Distinct values of a facet with how many options carry each, biggest first. */
function facetValues(options: PickerOption[], key: string) {
  const counts = new Map<string, number>()
  for (const o of options) {
    const v = o.facets?.[key]
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
}

export type EntityPickerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog title, e.g. "Choose a project". */
  title: string
  /** What is being chosen, lower case: "project". Used in the search hint. */
  noun: string
  /** A list the caller already holds. */
  options?: PickerOption[]
  /** Server search; takes over from `options`. Called with '' for the recents. */
  search?: (query: string) => Promise<PickerSearchResult>
  facets?: PickerFacet[]
  /** The chosen id, marked in the list. */
  value?: string
  /** Offers a first row that chooses nothing (`''`), e.g. "No reviewer yet". */
  clearLabel?: string
  /** A last row for an action that is not a record, e.g. "New client…". */
  footerOption?: PickerOption
  loading?: boolean
  onPick: (id: string, option: PickerOption | null) => void
  /** Tick several rows and confirm once; `values` are the ids already chosen. */
  multiple?: boolean
  values?: string[]
  confirmLabel?: (n: number) => string
  onPickMany?: (ids: string[], options: PickerOption[]) => void
}

export function EntityPickerDialog({
  open,
  onOpenChange,
  title,
  noun,
  options = [],
  search,
  facets = [],
  value,
  clearLabel,
  footerOption,
  loading: loadingProp,
  onPick,
  multiple,
  values,
  confirmLabel,
  onPickMany,
}: EntityPickerDialogProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="top-[8vh] w-[min(720px,calc(100vw-32px))] max-h-[84vh]"
    >
      <div className="flex shrink-0 items-center border-b border-border-subtle px-3.5 pb-2 pt-3 max-md:pt-2">
        <span className="flex-1 font-heading text-[15px] font-semibold">
          {title}
        </span>
      </div>
      {open ? (
        <EntityPicker
          noun={noun}
          options={options}
          search={search}
          facets={facets}
          value={value}
          clearLabel={clearLabel}
          footerOption={footerOption}
          loading={loadingProp}
          multiple={multiple}
          values={values}
          confirmLabel={confirmLabel}
          onCancel={() => onOpenChange(false)}
          onPickMany={(ids, opts) => {
            onPickMany?.(ids, opts)
            onOpenChange(false)
          }}
          onPick={(id, option) => {
            onPick(id, option)
            onOpenChange(false)
          }}
        />
      ) : null}
    </CommandDialog>
  )
}

function EntityPicker({
  noun,
  options: localOptions = [],
  search,
  facets = [],
  value,
  clearLabel,
  footerOption,
  loading: loadingProp,
  onPick,
  multiple,
  values = [],
  confirmLabel,
  onPickMany,
  onCancel,
}: Omit<EntityPickerDialogProps, 'open' | 'onOpenChange' | 'title'> & {
  onCancel?: () => void
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Map<string, PickerOption | null>>(
    () =>
      new Map(
        values.map((id) => [id, localOptions.find((o) => o.id === id) ?? null]),
      ),
  )
  const [active, setActive] = useState<Record<string, string[]>>({})
  const [remote, setRemote] = useState<PickerSearchResult | null>(null)
  const [busy, setBusy] = useState(Boolean(search))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!search) return
    let live = true
    setBusy(true)
    const timer = setTimeout(
      () => {
        void search(q).then(
          (r) => {
            if (!live) return
            setRemote(r)
            setFailed(false)
            setBusy(false)
          },
          () => {
            if (!live) return
            setRemote(null)
            setFailed(true)
            setBusy(false)
          },
        )
      },
      q ? 150 : 0,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, search])

  // The pool the facet chips count from: every local option, or what the last
  // search returned.
  const pool = search ? (remote?.options ?? []) : localOptions
  // Any field the options carry can be filtered on. A caller names and orders
  // the ones it knows; the rest are listed under their own key.
  const fieldKeys = [
    ...facets.map((f) => f.key),
    ...[...new Set(pool.flatMap((o) => Object.keys(o.facets ?? {})))].filter(
      (k) => !facets.some((f) => f.key === k),
    ),
  ]
  const fields = fieldKeys
    .map((key) => ({
      key,
      label: facets.find((f) => f.key === key)?.label ?? humanise(key),
      values: facetValues(pool, key),
    }))
    .filter((f) => f.values.length > 1 || f.key in active)
  const matched = useMemo(
    () =>
      search
        ? filterPickerOptions(pool, '', active)
        : filterPickerOptions(pool, q, active),
    [pool, q, active, search],
  )
  const visible = matched.slice(0, RENDER_CAP)
  const total = search ? (remote?.total ?? matched.length) : matched.length
  const loading = (search ? busy : false) || Boolean(loadingProp)

  const groups = useMemo(() => {
    const out: { key: string; items: PickerOption[] }[] = []
    const heading = (o: PickerOption) =>
      o.group ??
      (remote?.recent && search ? t('notebook.entityPicker.recent') : '')
    for (const o of visible) {
      const key = heading(o)
      const g = out.find((x) => x.key === key)
      if (g) g.items.push(o)
      else out.push({ key, items: [o] })
    }
    return out
  }, [visible, remote?.recent, search])

  const toggle = (key: string, v: string) =>
    setActive((a) => {
      const next = { ...a }
      const cur = next[key] ?? []
      const vals = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
      if (vals.length) next[key] = vals
      else delete next[key]
      return next
    })
  const clearField = (key: string) =>
    setActive((a) => {
      const next = { ...a }
      delete next[key]
      return next
    })
  const anyFilter = Object.keys(active).length > 0

  const choose = (o: PickerOption) => {
    if (!multiple) {
      onPick(o.id, o)
      return
    }
    setPicked((p) => {
      const next = new Map(p)
      if (next.has(o.id)) next.delete(o.id)
      else next.set(o.id, o)
      return next
    })
  }
  const renderItem = (o: PickerOption) => {
    const chosen = multiple ? picked.has(o.id) : o.id === value
    return (
      <CommandItem
        key={o.id}
        value={o.id}
        disabled={o.disabled}
        onSelect={() => choose(o)}
        data-option-id={o.id}
        aria-checked={multiple ? chosen : undefined}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5"
      >
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            {o.identifier ? (
              <span className="mono shrink-0 text-fg-muted">
                {o.identifier}
              </span>
            ) : null}
            <span className="truncate">{o.label}</span>
          </span>
          {o.detail ? (
            <span className="block truncate text-label text-fg-muted">
              {o.detail}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 pt-px text-label">
          {o.disabled && o.disabledReason ? (
            <span className="text-fg-muted">{o.disabledReason}</span>
          ) : o.status ? (
            <Status tone={o.status.tone}>{o.status.label}</Status>
          ) : null}
          {multiple ? (
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-4 items-center justify-center rounded-[4px] border border-border-strong bg-surface',
                chosen &&
                  'border-primary bg-primary text-on-accent [&_svg]:text-on-accent',
              )}
            >
              {chosen ? <Icon name="check" size={12} strokeWidth={2} /> : null}
            </span>
          ) : chosen ? (
            <Icon
              name="check"
              size={14}
              strokeWidth={2}
              aria-label={t('notebook.entityPicker.chosenAriaLabel')}
            />
          ) : null}
        </span>
      </CommandItem>
    )
  }

  return (
    <Command
      label={t('notebook.entityPicker.label', { noun })}
      query={q}
      onQueryChange={setQ}
      shouldFilter={false}
      loading={loading}
      className="min-h-0 flex-1"
    >
      <CommandInput
        placeholder={t('notebook.entityPicker.searchNounSByPlaceholder', {
          noun,
        })}
        aria-label={t('notebook.entityPicker.searchNounSAriaLabel', { noun })}
      />
      {fields.length ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-subtle px-3.5 py-2">
          {fields
            .filter((f) => f.key in active)
            .map((f) => (
              <FilterChip
                key={f.key}
                field={f}
                selected={active[f.key]}
                onToggle={(v) => toggle(f.key, v)}
                onRemove={() => clearField(f.key)}
              />
            ))}
          <AddFilter
            fields={fields.filter((f) => !(f.key in active))}
            hasActive={anyFilter}
            onToggle={toggle}
          />
          {anyFilter ? (
            <button
              type="button"
              className="cursor-pointer text-label text-fg-muted hover:text-fg"
              onClick={() => setActive({})}
            >
              {t('notebook.entityPicker.clearAll')}
            </button>
          ) : null}
        </div>
      ) : null}
      <CommandList
        label={`${noun}s`}
        className="max-h-[420px] max-md:max-h-none"
      >
        <CommandLoading loading={loading} />
        {!loading ? (
          <>
            {clearLabel && !q && !anyFilter ? (
              <CommandGroup>
                <CommandItem
                  value="__clear"
                  onSelect={() => onPick('', null)}
                  className={cn(value === '' && 'font-medium')}
                >
                  <span className="flex-1">{clearLabel}</span>
                  {value === '' ? (
                    <Icon name="check" size={14} strokeWidth={2} />
                  ) : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.map((g) => (
              <CommandGroup key={g.key || 'all'} heading={g.key || undefined}>
                {g.items.map(renderItem)}
              </CommandGroup>
            ))}
            {footerOption ? (
              <CommandGroup>{renderItem(footerOption)}</CommandGroup>
            ) : null}
          </>
        ) : null}
        {failed && !loading ? (
          <p role="alert" className="px-3.5 py-6 text-center text-fg-muted">
            <span className="block font-medium text-fg">
              {t('notebook.entityPicker.searchFailed')}
            </span>
            {t('notebook.entityPicker.checkYourConnectionAnd')}
          </p>
        ) : null}
        {!failed ? (
          <CommandEmpty>
            {q || anyFilter ? (
              <>
                <span className="block font-medium text-fg">
                  {q
                    ? t('notebook.entityPicker.noMatchesForQuery', {
                        noun,
                        query: q,
                      })
                    : t('notebook.entityPicker.noMatchesForFilters', { noun })}
                </span>
                {anyFilter ? (
                  <button
                    type="button"
                    className="mt-1 cursor-pointer text-link underline"
                    onClick={() => setActive({})}
                  >
                    {t('notebook.entityPicker.clearFilters')}
                  </button>
                ) : (
                  t('notebook.entityPicker.tryAnIdOr')
                )}
              </>
            ) : (
              t('notebook.entityPicker.noNounSYet', { noun })
            )}
          </CommandEmpty>
        ) : null}
      </CommandList>
      <CommandFooter>
        <span className={cn('num', !multiple && 'ml-auto')}>
          {remote?.recent && search && !q
            ? t('notebook.entityPicker.recentTypeToSearch')
            : total > visible.length
              ? t('notebook.entityPicker.showingCountOfTotal', {
                  count: visible.length,
                  total,
                })
              : t(
                  total === 1
                    ? 'notebook.entityPicker.totalOne'
                    : 'notebook.entityPicker.totalMany',
                  { total, noun },
                )}
        </span>
        {multiple ? (
          <span className="ml-auto flex items-center gap-2 max-md:w-full">
            <span className="num max-md:flex-1">
              {picked.size
                ? t('common.counts.selected', { count: picked.size })
                : t('notebook.entityPicker.pickOneOrMore')}
            </span>
            {onCancel ? (
              <Button size="sm" onClick={onCancel}>
                {t('common.actions.cancel')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                onPickMany?.(
                  [...picked.keys()],
                  [...picked.values()].filter((o): o is PickerOption =>
                    Boolean(o),
                  ),
                )
              }
            >
              {confirmLabel
                ? confirmLabel(picked.size)
                : picked.size
                  ? t('notebook.entityPicker.addSize', { size: picked.size })
                  : t('common.actions.done')}
            </Button>
          </span>
        ) : null}
      </CommandFooter>
    </Command>
  )
}

const sizes = {
  md: 'h-[30px] max-md:h-10 text-body',
  sm: 'h-[26px] max-md:h-8 text-label',
} as const

export type PickerSelectProps = Omit<
  EntityPickerDialogProps,
  'open' | 'onOpenChange' | 'title' | 'onPick' | 'value'
> & {
  value: string
  onChange: (id: string, option: PickerOption | null) => void
  /** Dialog title; defaults to "Choose a {noun}". */
  title?: string
  /** Shown when nothing is chosen; defaults to "Choose a {noun}…". */
  placeholder?: string
  /**
   * The chosen record, for a `search` picker whose value may not be in the
   * current results (a stored id loaded from the server).
   */
  selected?: PickerOption | null
  disabled?: boolean
  invalid?: boolean
  size?: keyof typeof sizes
  className?: string
  id?: string
  'aria-label'?: string
}

export function PickerSelect({
  value,
  onChange,
  title,
  placeholder,
  selected,
  disabled,
  invalid,
  size = 'md',
  className,
  id,
  'aria-label': ariaLabel,
  clearLabel,
  ...picker
}: PickerSelectProps) {
  const [open, setOpen] = useState(false)
  const current =
    selected ??
    picker.options?.find((o) => o.id === value) ??
    (picker.footerOption?.id === value ? picker.footerOption : undefined)
  const empty = !value || !current
  const text = current
    ? current.label
    : value === '' && clearLabel
      ? clearLabel
      : (placeholder ??
        t('notebook.entityPicker.chooseANoun', { noun: picker.noun }))

  return (
    <>
      <button
        type="button"
        id={id}
        data-slot="picker-select"
        data-value={value || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          'relative flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface pl-2 pr-7 text-left text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--danger)] disabled:cursor-default disabled:bg-surface-disabled disabled:text-fg-muted',
          sizes[size],
          className,
        )}
      >
        {current?.identifier ? (
          <span className="mono shrink-0 text-fg-muted">
            {current.identifier}
          </span>
        ) : null}
        <span className={cn('min-w-0 truncate', empty && 'text-fg-muted')}>
          {text}
        </span>
        <Icon
          name="chevronDown"
          size={size === 'sm' ? 12 : 14}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted"
        />
      </button>
      <EntityPickerDialog
        {...picker}
        clearLabel={clearLabel}
        open={open}
        onOpenChange={setOpen}
        title={title ?? t('notebook.entityPicker.label', { noun: picker.noun })}
        value={value}
        onPick={onChange}
      />
    </>
  )
}

export type PickerMultiSelectProps = Omit<
  EntityPickerDialogProps,
  | 'open'
  | 'onOpenChange'
  | 'title'
  | 'onPick'
  | 'value'
  | 'multiple'
  | 'values'
  | 'onPickMany'
> & {
  values: string[]
  onChange: (ids: string[], options: PickerOption[]) => void
  title?: string
  placeholder?: string
  /** The chosen records when they may not be in `options` (search pickers). */
  selected?: PickerOption[]
  disabled?: boolean
  invalid?: boolean
  size?: keyof typeof sizes
  className?: string
  id?: string
  'aria-label'?: string
}

/**
 * The multiple-choice form control: the chosen records as removable chips and
 * a button that opens the picker with checkboxes.
 */
export function PickerMultiSelect({
  values,
  onChange,
  title,
  placeholder,
  selected,
  disabled,
  invalid,
  size = 'md',
  className,
  id,
  'aria-label': ariaLabel,
  ...picker
}: PickerMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const known = new Map<string, PickerOption>()
  for (const o of [...(picker.options ?? []), ...(selected ?? [])])
    known.set(o.id, o)
  const chosen = values.map((v) => known.get(v) ?? { id: v, label: v })
  const remove = (removed: string) => {
    const ids = values.filter((v) => v !== removed)
    onChange(
      ids,
      ids.map((v) => known.get(v)).filter((o): o is PickerOption => !!o),
    )
  }
  return (
    <>
      <div
        className={cn(
          'flex min-h-[30px] w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface p-1 pl-1.5 aria-invalid:border-danger',
          disabled && 'bg-surface-disabled',
          className,
        )}
        aria-invalid={invalid || undefined}
      >
        {chosen.map((o) => (
          <Chip
            key={o.id}
            variant="remove"
            removeLabel={t('notebook.entityPicker.removeLabel', {
              label: o.label,
            })}
            onRemove={disabled ? undefined : () => remove(o.id)}
          >
            {o.identifier ? (
              <span className="mono text-fg-muted">{o.identifier}</span>
            ) : null}
            {o.label}
          </Chip>
        ))}
        <button
          type="button"
          id={id}
          data-slot="picker-select"
          aria-haspopup="dialog"
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-label text-fg-muted hover:bg-surface-hover hover:text-fg disabled:cursor-default"
        >
          <Icon name="plus" size={12} />
          {chosen.length
            ? t('common.actions.add')
            : (placeholder ??
              t('notebook.entityPicker.chooseNounS', { noun: picker.noun }))}
        </button>
      </div>
      <EntityPickerDialog
        {...picker}
        open={open}
        onOpenChange={setOpen}
        title={title ?? t('notebook.entityPicker.title', { noun: picker.noun })}
        multiple
        values={values}
        onPick={() => undefined}
        onPickMany={onChange}
      />
    </>
  )
}
