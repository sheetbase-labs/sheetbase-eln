import { Button } from '#/components/v3/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import { Icon } from '#/components/v3/icons'
import { cn } from '#/lib/utils'

/**
 * Shared list filter menu (R5-SHELL-04). A "Field: value" dropdown that sits in
 * a list toolbar: picking a value calls `onChange`; the "any" item clears it.
 *
 * Lists that already carry removable chips keep them — this menu is the
 * control that sets a filter, the chips stay the visible, removable record of
 * what is active. It carries the same keyboard model as every v3 menu (focus
 * trap, Esc, focus return) because it is the existing DropdownMenu.
 */
export type FilterMenuOption = string | { value: string; label: string }

export function FilterMenu({
  label,
  value,
  options: rawOptions,
  onChange,
  anyLabel = 'any',
  text,
  className,
}: {
  label: string
  value?: string
  options: FilterMenuOption[]
  onChange: (value: string | undefined) => void
  anyLabel?: string
  /** Trigger text when nothing is picked (default "${label}: ${anyLabel}"). */
  text?: string
  className?: string
}) {
  const options = rawOptions.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  )
  const current = options.find((o) => o.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            size="sm"
            className={cn(
              current && 'bg-selection hover:bg-selection',
              className,
            )}
          />
        }
      >
        {current
          ? `${label}: ${current.label}`
          : (text ?? `${label}: ${anyLabel}`)}
        <Icon name="chevronDown" size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[360px] w-[220px] overflow-auto">
        <DropdownMenuItem
          icon={!current ? 'check' : undefined}
          className={!current ? undefined : 'pl-[30px]'}
          onClick={() => onChange(undefined)}
        >
          {anyLabel.charAt(0).toUpperCase() + anyLabel.slice(1)}
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            icon={o.value === value ? 'check' : undefined}
            className={o.value === value ? undefined : 'pl-[30px]'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
