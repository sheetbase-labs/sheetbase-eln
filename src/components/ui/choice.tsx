import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * Choice (DSYS-04): a radio or checkbox with a title and a consequence line,
 * rendered as a bordered card. The design shows the checked card with the
 * accent border and subtle selection wash, and the disabled card on the
 * disabled surface.
 */
export interface ChoiceProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'title'
> {
  title: React.ReactNode
  description?: React.ReactNode
  type?: 'radio' | 'checkbox'
}

export function Choice({
  title,
  description,
  type = 'checkbox',
  className,
  disabled,
  ...props
}: ChoiceProps) {
  return (
    <label
      data-slot="choice"
      data-disabled={disabled ? '' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-caption leading-[17px]',
        disabled
          ? 'cursor-default bg-surface-disabled text-muted-foreground'
          : 'cursor-pointer hover:bg-accent has-checked:border-link has-checked:bg-selection-subtle',
        className,
      )}
    >
      <input
        type={type}
        disabled={disabled}
        className="mt-0.5 accent-[var(--link)]"
        {...props}
      />
      <span className="min-w-0">
        <b className="block font-medium text-foreground">{title}</b>
        {description ? (
          <span className="block text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
