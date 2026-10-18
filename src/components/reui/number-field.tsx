'use client'

import type { ReactNode } from 'react'
import { createContext, useContext, useId } from 'react'
import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field'
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

import { cn } from '#/lib/utils'
import { MinusIcon, PlusIcon } from 'lucide-react'

const NumberFieldContext = createContext<{
  fieldId: string
  size: 'sm' | 'default' | 'lg'
} | null>(null)

const numberFieldGroupVariants = cva(
  'relative flex w-full justify-between border border-border data-disabled:pointer-events-none data-disabled:opacity-50 aria-invalid:border-danger focus-within:has-aria-invalid:border-danger rounded-md bg-surface transition-colors focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus',
  {
    variants: {
      size: {
        sm: 'h-7 text-label',
        default: 'h-[30px] text-body',
        lg: 'h-9 text-body',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

const numberFieldButtonVariants = cva(
  'relative flex shrink-0 cursor-pointer items-center justify-center transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-surface-hover',
  {
    variants: {
      // Ladders restored from the pre-rename source. Rhea was added after they
      // were written, so its rungs are new: rhea tracks nova here because the
      // shadcn Input is h-8 px-2.5 in both sheets, where luma is h-9 px-3.
      size: {
        sm: ['px-1.5', "[&_svg:not([class*='size-'])]:size-3.5"],
        default: ['px-2', "[&_svg:not([class*='size-'])]:size-4"],
        lg: ['px-2.5', "[&_svg:not([class*='size-'])]:size-4"],
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

const numberFieldInputVariants = cva(
  // The v3 kit draws the focus indicator on the input itself
  // (`src/components/v3/ui/input.tsx`), not on a wrapper: restyling to
  // Sheetbase tokens means the same treatment here, so the focused control —
  // and not only the group around it — shows the ring.
  'w-full min-w-0 flex-1 bg-transparent text-center tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
  {
    variants: {
      size: {
        sm: 'px-2 py-0.5',
        default: 'px-2.5 py-1',
        lg: 'px-2.5 py-1.5',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

function NumberField({
  id,
  className,
  size = 'default',
  ...props
}: NumberFieldPrimitive.Root.Props &
  VariantProps<typeof numberFieldGroupVariants>) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const sizeValue = size ?? 'default'

  return (
    <NumberFieldContext.Provider value={{ fieldId, size: sizeValue }}>
      <NumberFieldPrimitive.Root
        className={cn('flex w-full flex-col items-start gap-2', className)}
        data-size={sizeValue}
        data-slot="number-field"
        id={fieldId}
        {...props}
      />
    </NumberFieldContext.Provider>
  )
}

function NumberFieldGroup({
  className,
  size: sizeProp,
  ...props
}: NumberFieldPrimitive.Group.Props &
  Partial<VariantProps<typeof numberFieldGroupVariants>>) {
  const context = useContext(NumberFieldContext)
  if (!context) {
    throw new Error(
      'NumberFieldGroup must be used within a NumberField component.',
    )
  }
  const size = sizeProp ?? context.size

  return (
    <NumberFieldPrimitive.Group
      className={cn(numberFieldGroupVariants({ size }), className)}
      data-slot="number-field-group"
      {...props}
    />
  )
}

function NumberFieldDecrement({
  className,
  size: sizeProp,
  children,
  ...props
}: NumberFieldPrimitive.Decrement.Props &
  Partial<VariantProps<typeof numberFieldButtonVariants>> & {
    children?: React.ReactNode
  }) {
  const context = useContext(NumberFieldContext)
  if (!context) {
    throw new Error(
      'NumberFieldDecrement must be used within a NumberField component.',
    )
  }
  const size = sizeProp ?? context.size

  return (
    <NumberFieldPrimitive.Decrement
      className={cn(
        numberFieldButtonVariants({ size }),
        'rounded-s-lg border-e-0',
        className,
      )}
      data-slot="number-field-decrement"
      {...props}
    >
      {children ?? <MinusIcon />}
    </NumberFieldPrimitive.Decrement>
  )
}

function NumberFieldIncrement({
  className,
  size: sizeProp,
  children,
  ...props
}: NumberFieldPrimitive.Increment.Props &
  Partial<VariantProps<typeof numberFieldButtonVariants>> & {
    children?: ReactNode
  }) {
  const context = useContext(NumberFieldContext)
  if (!context) {
    throw new Error(
      'NumberFieldIncrement must be used within a NumberField component.',
    )
  }
  const size = sizeProp ?? context.size

  return (
    <NumberFieldPrimitive.Increment
      className={cn(
        numberFieldButtonVariants({ size }),
        'rounded-e-lg border-s-0',
        className,
      )}
      data-slot="number-field-increment"
      {...props}
    >
      {children ?? <PlusIcon />}
    </NumberFieldPrimitive.Increment>
  )
}

function NumberFieldInput({
  className,
  size: sizeProp,
  ...props
}: NumberFieldPrimitive.Input.Props &
  Partial<VariantProps<typeof numberFieldInputVariants>>) {
  const context = useContext(NumberFieldContext)
  if (!context) {
    throw new Error(
      'NumberFieldInput must be used within a NumberField component.',
    )
  }
  const size = sizeProp ?? context.size

  return (
    <NumberFieldPrimitive.Input
      className={cn(numberFieldInputVariants({ size }), className)}
      data-slot="number-field-input"
      {...props}
    />
  )
}

function NumberFieldScrubArea({
  className,
  label,
  ...props
}: NumberFieldPrimitive.ScrubArea.Props & {
  label: string
}) {
  const context = useContext(NumberFieldContext)
  if (!context) {
    throw new Error(
      'NumberFieldScrubArea must be used within a NumberField component for accessibility.',
    )
  }

  return (
    <NumberFieldPrimitive.ScrubArea
      className={cn('flex cursor-ew-resize', className)}
      data-slot="number-field-scrub-area"
      {...props}
    >
      <label
        className="cursor-ew-resize text-label text-fg"
        htmlFor={context.fieldId}
      >
        {label}
      </label>
      <NumberFieldPrimitive.ScrubAreaCursor className="filter">
        <CursorGrowIcon />
      </NumberFieldPrimitive.ScrubAreaCursor>
    </NumberFieldPrimitive.ScrubArea>
  )
}

function CursorGrowIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      fill="black"
      height="14"
      stroke="white"
      viewBox="0 0 24 14"
      width="26"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M19.5 5.5L6.49737 5.51844V2L1 6.9999L6.5 12L6.49737 8.5L19.5 8.5V12L25 6.9999L19.5 2V5.5Z" />
    </svg>
  )
}

export {
  NumberField,
  NumberFieldScrubArea,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldGroup,
  NumberFieldInput,
}
