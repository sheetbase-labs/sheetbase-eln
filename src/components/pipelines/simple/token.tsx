import { Icon } from '#/components/icons'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

const TOKEN =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-muted pl-2 pr-1.5 font-sans text-body font-medium text-fg hover:bg-surface-hover'

/**
 * One boxed choice in the recipe sentence. It is a native select dressed as the
 * chip: the chip shows the chosen words, and the transparent select on top of
 * it gives the keyboard, the screen reader and the phone picker for free.
 */
export function TokenSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
  icon,
  className,
}: {
  /** Names the control for people who cannot see the sentence. */
  label: string
  value: string
  /** Shown when nothing is chosen yet. */
  placeholder: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
  icon?: IconName
  className?: string
}) {
  const chosen = options.find((option) => option.value === value)

  return (
    <span
      className={cn(
        TOKEN,
        'relative',
        !chosen && 'border-dashed text-fg-muted',
        className,
      )}
    >
      {icon ? <Icon name={icon} size={14} className="text-fg-muted" /> : null}
      <span className="truncate">{chosen?.label ?? placeholder}</span>
      <Icon name="chevronDown" size={12} className="text-fg-muted" />
      <select
        aria-label={label}
        value={chosen ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {chosen ? null : (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}

/** A boxed text or number the person types into, sized to what it holds. */
export function TokenInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  suffix,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
  placeholder?: string
  suffix?: string
  className?: string
}) {
  return (
    <label className={cn(TOKEN, 'cursor-text', className)}>
      <input
        aria-label={label}
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{ width: `${Math.max(4, value.length + 2)}ch` }}
        className="min-w-[4ch] max-w-[24ch] bg-transparent text-fg outline-none placeholder:text-fg-muted"
      />
      {suffix ? <span className="text-fg-muted">{suffix}</span> : null}
    </label>
  )
}

/** The dashed "and…" button that adds a line. */
export function TokenAdd({
  children,
  onClick,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border bg-transparent px-2 font-sans text-body text-fg-muted hover:bg-surface-hover"
      {...props}
    >
      {children}
    </button>
  )
}
