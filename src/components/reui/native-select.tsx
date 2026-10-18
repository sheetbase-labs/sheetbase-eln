/**
 * Stock shadcn `native-select`, installed from the shadcn registry and placed
 * here by hand (ADR-0055 decision 2; see docs/development/component-compare.md):
 *
 *   pnpm dlx shadcn@latest add native-select
 *
 * It is **stock shadcn, not a ReUI item**: the pinned ReUI registry serves no
 * `native-select` and no `select` at all, so there is no base-nova build of
 * this job to install. Recorded that way in
 * docs/knowledge/design/component-comparison-record.md.
 *
 * Copy-and-own source. The changes are the `cn` import, re-pointed from the
 * `cn` package to `#/lib/utils`, and the colour tokens, restyled to Sheetbase
 * tokens as an adoption would have to. Structure, sizes, `data-slot`s and the
 * `NativeSelectOption`/`NativeSelectOptGroup` exports are as published.
 */
import * as React from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '#/lib/utils'

function NativeSelect({
  className,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
}) {
  return (
    <div
      className="group/native-select relative w-fit has-[select:disabled]:opacity-50"
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          'h-9 w-full min-w-0 appearance-none rounded-md border border-border bg-surface px-3 py-2 pr-9 text-body text-fg transition-[color,box-shadow] disabled:pointer-events-none disabled:cursor-not-allowed data-[size=sm]:h-8 data-[size=sm]:py-1',
          // The published item uses `outline-none` with a `ring-*` focus ring;
          // restyling to our tokens means our outline, so `outline-none` goes
          // with it — leaving it in cancels the outline the restyle adds.
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          'aria-invalid:border-danger aria-invalid:shadow-[0_0_0_1px_var(--danger)]',
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-fg-muted opacity-50 select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn('bg-[Canvas] text-[CanvasText]', className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
