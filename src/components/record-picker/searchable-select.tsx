import { Children, Fragment, isValidElement } from 'react'
import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'
import { PickerSelect } from './entity-picker'
import type { PickerOption } from './entity-picker'

/**
 * Searchable select: the drop-in for a `<Select>` whose list can grow past a
 * screenful (every project, person, instrument, event type). It takes the same
 * `<option>` and `<optgroup>` children, so a caller keeps the markup it has,
 * and opens the shared entity picker: a search box over the list, headings for
 * the groups, keyboard and phone friendly. A short fixed list (a currency, a
 * weekday) stays a plain `Select`.
 *
 * Like a native select it fills a block and shrinks to its text in a toolbar.
 * An `<option value="">` becomes the "choose nothing" row. Pass `onValueChange`
 * (the chosen value), not an `onChange` event.
 */

interface ElementProps {
  value?: string | number
  label?: string
  disabled?: boolean
  children?: ReactNode
}

/** The words an option shows, flattened from whatever it wraps. */
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<ElementProps>(child)
        ? textOf(child.props.children)
        : String(child),
    )
    .join('')
}

interface Parsed {
  options: PickerOption[]
  clearLabel?: string
}

function parse(children: ReactNode, group: string | undefined, into: Parsed) {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<ElementProps>(child)) continue

    if (child.type === Fragment) {
      parse(child.props.children, group, into)
      continue
    }

    if (child.type === 'optgroup') {
      parse(child.props.children, child.props.label, into)
      continue
    }

    if (child.type === 'option') {
      const label = textOf(child.props.children)
      const value = String(child.props.value ?? label)

      if (value === '') {
        into.clearLabel = label
        continue
      }

      into.options.push({
        id: value,
        label,
        group,
        disabled: child.props.disabled,
      })
    }
  }
}

export function SearchableSelect({
  noun,
  value,
  onValueChange,
  children,
  disabled,
  invalid,
  size,
  className,
  id,
  title,
  placeholder,
  'aria-label': ariaLabel,
}: {
  /** What is being chosen, lower case: "project". */
  noun: string
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
  disabled?: boolean
  invalid?: boolean
  size?: 'md' | 'sm'
  className?: string
  id?: string
  title?: string
  placeholder?: string
  'aria-label'?: string
}) {
  const parsed: Parsed = { options: [] }

  parse(children, undefined, parsed)

  return (
    <PickerSelect
      noun={noun}
      value={value}
      onChange={(next) => onValueChange(next)}
      options={parsed.options}
      clearLabel={parsed.clearLabel}
      disabled={disabled}
      invalid={invalid}
      size={size}
      className={cn('w-auto', className)}
      id={id}
      title={title}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  )
}
