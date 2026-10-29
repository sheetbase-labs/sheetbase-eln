import { useEffect, useState } from 'react'

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
import { Button } from '#/components/v3/ui/button'
import { Chip } from '#/components/v3/ui/chip'
import { Status } from '#/components/v3/ui/status'
import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import { cn } from '#/lib/utils'
import { t } from '#/copy'
import { pickerKinds, searchPickerRecords } from './record-picker-data'
import type { PickerItem, PickerKind, PickerResult } from './record-picker-data'

/**
 * Record picker: find a sample, material, dataset or experiment by ID or name
 * and link it. Built on Command. An empty query shows the person's own recent
 * records (`api.recently_viewed`, FIND-01); a person with no history sees the
 * honest "Nothing recent" line rather than fabricated rows. Type chips narrow
 * the search; records already linked are shown but can't be picked.
 */
export const kindIcon: Record<PickerKind, IconName> = {
  Sample: 'tube',
  Material: 'box',
  Dataset: 'database',
  Experiment: 'flask',
}
const plural: Record<PickerKind, string> = {
  Sample: t('projects.recordPicker.kinds.Sample'),
  Material: t('projects.recordPicker.kinds.Material'),
  Dataset: t('projects.recordPicker.kinds.Dataset'),
  Experiment: t('projects.recordPicker.kinds.Experiment'),
}

export type RecordPickerProps = {
  /** Which types the chips start on. Empty or undefined: all types. */
  kinds?: PickerKind[]
  /** Offer only these types (no chips for the others). */
  allowed?: PickerKind[]
  /** IDs already linked: shown with "Linked" and not selectable. */
  exclude?: string[]
  multiple?: boolean
  confirmLabel?: (n: number) => string
  onPick: (items: PickerItem[]) => void
  onCancel?: () => void
  autoFocus?: boolean
  className?: string
}

export function RecordPicker({
  kinds: initialKinds,
  allowed = pickerKinds,
  exclude = [],
  multiple = false,
  confirmLabel,
  onPick,
  onCancel,
  autoFocus = true,
  className,
}: RecordPickerProps) {
  const [q, setQ] = useState('')
  const [kinds, setKinds] = useState<PickerKind[]>(initialKinds ?? [])
  const [res, setRes] = useState<PickerResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<PickerItem[]>([])
  const filter = kinds.length ? kinds : allowed

  useEffect(() => {
    let live = true
    setLoading(true)
    const timer = setTimeout(
      () => {
        void searchPickerRecords({ q, kinds: filter }).then(
          (r) => {
            if (live) {
              setRes(r)
              setFailed(false)
              setLoading(false)
            }
          },
          () => {
            // A failed search must not leave the list on "Searching…".
            if (live) {
              setRes(null)
              setFailed(true)
              setLoading(false)
            }
          },
        )
      },
      q ? 150 : 0,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, filter.join(',')])

  const toggleKind = (k: PickerKind | null) =>
    setKinds(k === null ? [] : kinds.length === 1 && kinds[0] === k ? [] : [k])
  const choose = (item: PickerItem) => {
    if (!multiple) {
      onPick([item])
      return
    }
    setPicked((p) =>
      p.some((x) => x.id === item.id)
        ? p.filter((x) => x.id !== item.id)
        : [...p, item],
    )
  }
  const items = res?.items ?? []
  const groups = res?.recent
    ? [{ key: t('projects.recordPicker.recent'), items }]
    : allowed
        .map((k) => ({
          key: plural[k],
          items: items.filter((i) => i.kind === k),
        }))
        .filter((g) => g.items.length)
  const scope =
    kinds.length === 1
      ? plural[kinds[0]].toLowerCase()
      : allowed.length === pickerKinds.length
        ? t('projects.recordPicker.records')
        : allowed.map((k) => plural[k].toLowerCase()).join(', ')

  return (
    <Command
      label={t('projects.recordPicker.label')}
      query={q}
      onQueryChange={setQ}
      shouldFilter={false}
      className={cn('min-h-0 flex-1', className)}
    >
      <CommandInput
        placeholder={t('projects.recordPicker.placeholder', { scope })}
        autoFocus={autoFocus}
      />
      {allowed.length > 1 ? (
        <div
          role="group"
          aria-label={t('projects.recordPicker.type')}
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border-subtle px-3.5 py-2 [scrollbar-width:none]"
        >
          <Chip
            variant="toggle"
            pressed={kinds.length === 0}
            onClick={() => toggleKind(null)}
          >
            {t('projects.recordPicker.all')}
          </Chip>
          {allowed.map((k) => (
            <Chip
              key={k}
              variant="toggle"
              pressed={kinds.length === 1 && kinds[0] === k}
              onClick={() => toggleKind(k)}
              icon={kindIcon[k]}
              count={res && !res.recent ? res.counts[k] : undefined}
            >
              {plural[k]}
            </Chip>
          ))}
        </div>
      ) : null}
      <CommandList
        label={t('projects.recordPicker.list')}
        className="max-h-[360px] max-md:max-h-none"
      >
        <CommandLoading loading={loading} />
        {!loading
          ? groups.map((g) => (
              <CommandGroup key={g.key} heading={g.key}>
                {g.items.map((i) => {
                  const linked = exclude.includes(i.id)
                  const on = picked.some((p) => p.id === i.id)
                  return (
                    <CommandItem
                      key={i.id}
                      value={i.id}
                      disabled={linked}
                      onSelect={() => choose(i)}
                      aria-checked={multiple ? on : undefined}
                      className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2.5 md:grid-cols-[16px_72px_minmax(0,1fr)_auto]"
                    >
                      <Icon
                        name={kindIcon[i.kind]}
                        size={14}
                        className="mt-0.5"
                      />
                      <span className="mono text-fg-muted max-md:hidden">
                        {i.identifier}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">
                          <span className="mono mr-1.5 text-fg-muted md:hidden">
                            {i.identifier}
                          </span>
                          {i.name}
                        </span>
                        <span className="block truncate text-label text-fg-muted">
                          {i.project}
                          {i.kind === 'Sample' || i.kind === 'Material'
                            ? ''
                            : t('projects.recordPicker.kindSuffix', {
                                kind: i.kind.toLowerCase(),
                              })}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 pt-px text-label">
                        {linked ? (
                          <span className="text-fg-muted">
                            {t('projects.recordPicker.linked')}
                          </span>
                        ) : (
                          <Status tone={i.status.tone}>{i.status.label}</Status>
                        )}
                        {multiple && !linked ? (
                          <span
                            aria-hidden="true"
                            className={cn(
                              'inline-flex size-4 items-center justify-center rounded-[4px] border border-border-strong bg-surface',
                              on &&
                                'border-primary bg-primary text-on-accent [&_svg]:text-on-accent',
                            )}
                          >
                            {on ? (
                              <Icon name="check" size={12} strokeWidth={2} />
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))
          : null}
        {failed && !loading ? (
          <p role="alert" className="px-3.5 py-6 text-center text-fg-muted">
            <span className="block font-medium text-fg">
              {t('projects.recordPicker.failed.title')}
            </span>
            {t('projects.recordPicker.failed.body')}
          </p>
        ) : null}
        {!failed ? (
          <CommandEmpty>
            {q ? (
              <>
                <span className="block font-medium text-fg">
                  {t('projects.recordPicker.noMatch', { scope, query: q })}
                </span>
                {t('projects.recordPicker.noMatchHint')}
              </>
            ) : (
              t('projects.recordPicker.nothingRecent')
            )}
          </CommandEmpty>
        ) : null}
      </CommandList>
      <CommandFooter>
        {multiple ? (
          <span className="ml-auto flex items-center gap-2 max-md:w-full">
            <span className="num max-md:flex-1">
              {picked.length
                ? t('projects.recordPicker.selected', { count: picked.length })
                : t('projects.recordPicker.pickMore')}
            </span>
            {onCancel ? (
              <Button size="sm" onClick={onCancel}>
                {t('common.actions.cancel')}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              disabled={!picked.length}
              onClick={() => onPick(picked)}
            >
              {confirmLabel
                ? confirmLabel(picked.length)
                : picked.length
                  ? t('projects.recordPicker.linkCount', {
                      count: picked.length,
                    })
                  : t('projects.recordPicker.link')}
            </Button>
          </span>
        ) : res && !res.recent ? (
          <span className="num ml-auto">
            {t('projects.recordPicker.found', { count: res.total })}
          </span>
        ) : null}
      </CommandFooter>
    </Command>
  )
}

/** The picker in a dialog (bottom sheet on phones). */
export function RecordPickerDialog({
  open,
  onOpenChange,
  title,
  ...props
}: RecordPickerProps & {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      className="w-[min(640px,calc(100vw-32px))]"
    >
      <div className="flex shrink-0 items-center border-b border-border-subtle px-3.5 pb-2 pt-3 max-md:pt-2">
        <span className="flex-1 font-heading text-[15px] font-semibold">
          {title}
        </span>
      </div>
      <RecordPicker
        {...props}
        onCancel={() => onOpenChange(false)}
        onPick={(i) => {
          props.onPick(i)
          onOpenChange(false)
        }}
      />
    </CommandDialog>
  )
}
