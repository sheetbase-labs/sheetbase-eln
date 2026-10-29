import { t } from '#/copy'
import { useState } from 'react'

import { Calendar } from '#/components/ui/calendar'
import { Icon } from '#/components/v3/icons'
import { Button } from '#/components/v3/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import { formatDate } from '#/lib/format-date'
import { cn } from '#/lib/utils'

/** A calendar day read from "YYYY-MM-DD", at local midnight so no time zone
 * moves it to the neighbouring day. */
function parseDay(day: string | undefined): Date | undefined {
  const match = day && /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return match ? new Date(+match[1], +match[2] - 1, +match[3]) : undefined
}

function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Sheetbase date field: a day picked from a calendar and read in the
 * workspace's date format ("25 Sep 2026"), not the browser's own mm/dd/yyyy
 * control. The value stays a bare "YYYY-MM-DD" day, so it round-trips through
 * a URL or a form exactly as `<input type="date">` did.
 */
export function DateField({
  value,
  onChange,
  label,
  placeholder = 'Any date',
  min,
  max,
  className,
}: {
  value: string | undefined
  onChange: (day: string | undefined) => void
  /** The control's accessible name; it also leads the placeholder. */
  label: string
  placeholder?: string
  /** The earliest and latest day that can be picked ("YYYY-MM-DD"). */
  min?: string
  max?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = parseDay(value)
  const earliest = parseDay(min)
  const latest = parseDay(max)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label={label}
            className={cn(
              'h-[26px] min-w-[116px] justify-between gap-2 px-2 text-label font-normal max-md:h-8',
              !selected && 'text-fg-muted',
              className,
            )}
          />
        }
      >
        {selected ? formatDate(value) : placeholder}
        <Icon name="calendar" size={12} className="text-fg-muted" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? latest ?? earliest}
          disabled={[
            ...(earliest ? [{ before: earliest }] : []),
            ...(latest ? [{ after: latest }] : []),
          ]}
          onSelect={(date) => {
            onChange(date ? toDay(date) : undefined)
            setOpen(false)
          }}
        />
        {selected ? (
          <div className="flex justify-end border-t border-border-subtle p-1.5">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              {t('common.actions.clear')}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
