/**
 * Choosing restriction enzymes: a searchable checklist with the usual ones
 * first, and shortcuts for the sets people want most.
 */
import { useMemo, useState } from 'react'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { t } from '#/copy'
import { COMMON_ENZYMES, ENZYMES, overhangOf } from '#/lib/molbio'
import type { Enzyme } from '#/lib/molbio'

function overhangLabel(e: Enzyme): string {
  const d = overhangOf(e)
  if (d === 0) return t('molbio.enzymes.blunt')
  return d > 0
    ? t('molbio.enzymes.fivePrime', { count: d })
    : t('molbio.enzymes.threePrime', { count: -d })
}

export function EnzymePicker({
  selected,
  onChange,
  uniqueCutters,
  disabled,
  only,
}: {
  selected: readonly string[]
  onChange: (names: string[]) => void
  /** Enzymes that cut this sequence once, for the shortcut. */
  uniqueCutters?: readonly string[]
  disabled?: boolean
  /** Offer only these enzymes (for example the Type IIS ones). */
  only?: readonly string[]
}) {
  const [filter, setFilter] = useState('')
  const list = useMemo(() => {
    const base = only ? ENZYMES.filter((e) => only.includes(e.name)) : ENZYMES
    const q = filter.trim().toLowerCase()
    const matched = q
      ? base.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.site.toLowerCase().includes(q),
        )
      : base
    const common = new Set(COMMON_ENZYMES)
    return [...matched].sort(
      (a, b) =>
        Number(common.has(b.name)) - Number(common.has(a.name)) ||
        a.name.localeCompare(b.name),
    )
  }, [filter, only])
  const set = new Set(selected)
  const toggle = (name: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(name)
    else next.delete(name)
    onChange([...next])
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('molbio.enzymes.search')}
          placeholder={t('molbio.enzymes.search')}
          className="w-48"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {!only ? (
          <>
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => onChange([...COMMON_ENZYMES])}
            >
              {t('molbio.enzymes.useCommon')}
            </Button>
            {uniqueCutters ? (
              <Button
                size="sm"
                disabled={disabled || uniqueCutters.length === 0}
                onClick={() => onChange([...uniqueCutters])}
              >
                {t('molbio.enzymes.useUnique', { count: uniqueCutters.length })}
              </Button>
            ) : null}
          </>
        ) : null}
        <Button
          size="sm"
          variant="quiet"
          disabled={disabled || selected.length === 0}
          onClick={() => onChange([])}
        >
          {t('molbio.enzymes.clear')}
        </Button>
        <span className="num text-label text-fg-muted">
          {t('molbio.enzymes.chosen', { count: selected.length })}
        </span>
      </div>
      <ul className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-x-3 gap-y-1 overflow-y-auto rounded-md border border-border p-2">
        {list.map((e) => (
          <li key={e.name}>
            <label className="flex cursor-pointer items-center gap-2 text-label">
              <Checkbox
                disabled={disabled}
                checked={set.has(e.name)}
                onCheckedChange={(v) => toggle(e.name, v)}
              />
              <span className="font-medium text-fg">{e.name}</span>
              <span className="num truncate text-fg-muted">
                {e.site}
                {e.typeIIS ? '' : ` · ${overhangLabel(e)}`}
              </span>
            </label>
          </li>
        ))}
        {list.length === 0 ? (
          <li className="text-label text-fg-muted">
            {t('molbio.enzymes.none')}
          </li>
        ) : null}
      </ul>
    </div>
  )
}
