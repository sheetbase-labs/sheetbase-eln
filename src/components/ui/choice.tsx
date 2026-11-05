import { Checkbox } from './checkbox'
import { Radio } from './radio-group'
import { cn } from '#/lib/utils'

// Choice (design system): an option with a title and one line on its consequence.
// Put radios inside <RadioGroup>; the safe or reversible option comes first.
const cls =
  'group flex cursor-pointer items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-label leading-[17px] hover:bg-surface-hover has-data-checked:border-link has-data-checked:bg-selection-subtle has-data-disabled:cursor-default has-data-disabled:bg-surface-disabled has-data-disabled:text-fg-muted'

function Body({
  title,
  children,
}: {
  title: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <span className="min-w-0">
      <span className="block font-medium text-fg">{title}</span>
      {children ? (
        <span className="block text-fg-muted">{children}</span>
      ) : null}
    </span>
  )
}

export function Choice({
  value,
  title,
  children,
  disabled,
  className,
}: {
  value: string
  title: React.ReactNode
  children?: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={cn(cls, className)}>
      <Radio value={value} disabled={disabled} className="mt-px" />
      <Body title={title}>{children}</Body>
    </label>
  )
}

export function ChoiceCheckbox({
  title,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Checkbox> & { title: React.ReactNode }) {
  return (
    <label className={cn(cls, className)}>
      <Checkbox className="mt-px" {...props} />
      <Body title={title}>{children}</Body>
    </label>
  )
}
